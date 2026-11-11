import type { NextRequest, NextResponse } from 'next/server';
import { apiError, isSameOrigin, json, parseBody } from '@/server/core/http';
import { authenticate } from '../authenticate';
import { clientAddress } from '../client-address';
import {
  DEVICE_MAX_AGE_SECONDS,
  deviceCookieName,
  deviceCookieValue,
  isKnownDevice,
} from '../device';
import type { AuthDeps } from '../guard';
import { createLoginLimiter } from '../login-limit';
import { createSession, purgeExpiredSessions } from '../session';
import { loginSchema } from '../validation';
import { setSessionCookie } from './cookies';

/**
 * Sign-in, with a limit on password guessing (counts are kept in the database, see login-limit.ts):
 *  - a client that does not carry this account's "known browser" cookie may fail 10 times per 15
 *    minutes for that account. Failures are counted per account but only HELD AGAINST clients without
 *    the cookie, so nobody can lock you out of your usual browser by guessing at your address;
 *  - a client that does carry it has a more generous allowance (30), in case the cookie is stolen;
 *  - if the operator says how many of their own proxies are in front (TRUSTED_PROXY_HOPS), 100 failures
 *    per network address are allowed as well. The address is taken from the proxies' entries in
 *    X-Forwarded-For, never from what a client wrote itself (see client-address.ts).
 */
export const makeLoginHandler = (deps: AuthDeps) => {
  const byAccount = createLoginLimiter({ max: 10 });
  const byKnownBrowser = createLoginLimiter({ max: 30 });
  const byAddress = createLoginLimiter({ max: 100 });
  return async (req: NextRequest): Promise<NextResponse> => {
    if (!isSameOrigin(req)) return apiError(403, 'FORBIDDEN_ORIGIN');
    const body = await parseBody(req, loginSchema);
    if (!body.ok) return body.response;

    const db = deps.db();
    const cfg = deps.config();
    const now = deps.now();
    const email = body.data.email.trim().toLowerCase();
    const known = isKnownDevice(
      cfg.secret,
      email,
      req.cookies.get(deviceCookieName(cfg.secret, email))?.value,
    );
    const address = clientAddress(req.headers.get('x-forwarded-for'), cfg.trustedProxyHops ?? 0);
    const accountKey = known ? `known:${email}` : `account:${email}`;
    const accountLimiter = known ? byKnownBrowser : byAccount;
    const addressKey = address ? `ip:${address}` : null;

    const wait = Math.max(
      await accountLimiter.retryAfter(db, accountKey, now),
      addressKey ? await byAddress.retryAfter(db, addressKey, now) : 0,
    );
    if (wait > 0) {
      const res = apiError(429, 'TOO_MANY_ATTEMPTS');
      res.headers.set('retry-after', String(wait));
      return res;
    }

    const user = await authenticate(db, body.data.email, body.data.password);
    if (!user) {
      await accountLimiter.fail(db, accountKey, now);
      if (addressKey) await byAddress.fail(db, addressKey, now);
      return apiError(401, 'INVALID_CREDENTIALS');
    }
    // Forget the failures that this KIND of client had. A known browser signing in must not wipe the
    // failures of everybody else (they are somebody guessing; they would get ten fresh tries).
    await accountLimiter.clear(db, accountKey);

    await purgeExpiredSessions(db, now);
    const { token, maxAgeSeconds } = await createSession(db, user.id, cfg, now);
    const res = json({ user });
    setSessionCookie(res, token, maxAgeSeconds, cfg.secureCookies);
    // From now on this browser is a known one for this account (the session cookie stays first).
    res.cookies.set(deviceCookieName(cfg.secret, email), deviceCookieValue(cfg.secret, email), {
      httpOnly: true,
      sameSite: 'lax',
      secure: cfg.secureCookies,
      path: '/',
      maxAge: DEVICE_MAX_AGE_SECONDS,
    });
    return res;
  };
};
