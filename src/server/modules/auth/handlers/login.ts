import type { NextRequest, NextResponse } from 'next/server';
import { apiError, isSameOrigin, json, parseBody } from '@/server/core/http';
import { authenticate } from '../authenticate';
import { clientAddress } from '../client-address';
import type { AuthDeps } from '../guard';
import { createLoginLimiter } from '../login-limit';
import { createSession, purgeExpiredSessions } from '../session';
import { loginSchema } from '../validation';
import { setSessionCookie } from './cookies';

/**
 * Sign-in, with a limit on password guessing that cannot be turned against the people it protects.
 *
 * There is deliberately NO limit per account: any limit that counts failures for an e-mail address can
 * be used by a stranger who knows the address (in this app every signed-in user can see everybody's) to
 * keep the owner from signing in. Attackers can only be told apart by where they come from, and the app
 * can know that only behind reverse proxies of its own: with TRUSTED_PROXY_HOPS set, one network address
 * may fail 100 times per 15 minutes, then gets a 429 (`Retry-After`) even for the right password. The
 * address is the entry our outermost proxy appended to X-Forwarded-For, counted from the END of the
 * header, so nothing the client wrote can change it (see client-address.ts). Without proxies the header
 * is not believed at all and this limit is off: guessing is then only slowed by the cost of the password
 * hash. The counts are kept in PostgreSQL, so they survive restarts and are shared by every instance.
 */
export const makeLoginHandler = (deps: AuthDeps, { addressMax = 100 } = {}) => {
  const byAddress = createLoginLimiter({ max: addressMax });
  return async (req: NextRequest): Promise<NextResponse> => {
    if (!isSameOrigin(req)) return apiError(403, 'FORBIDDEN_ORIGIN');
    const body = await parseBody(req, loginSchema);
    if (!body.ok) return body.response;

    const db = deps.db();
    const cfg = deps.config();
    const now = deps.now();
    const address = clientAddress(req.headers.get('x-forwarded-for'), cfg.trustedProxyHops ?? 0);
    const addressKey = address ? `ip:${address}` : null;

    if (addressKey) {
      const wait = await byAddress.retryAfter(db, addressKey, now);
      if (wait > 0) {
        const res = apiError(429, 'TOO_MANY_ATTEMPTS');
        res.headers.set('retry-after', String(wait));
        return res;
      }
    }

    const user = await authenticate(db, body.data.email, body.data.password);
    if (!user) {
      if (addressKey) await byAddress.fail(db, addressKey, now);
      return apiError(401, 'INVALID_CREDENTIALS');
    }
    // A successful sign-in does NOT reset the address's failures: whoever guesses could otherwise sign
    // in to an account of their own between guesses and start over.

    await purgeExpiredSessions(db, now);
    const { token, maxAgeSeconds } = await createSession(db, user.id, cfg, now);
    const res = json({ user });
    setSessionCookie(res, token, maxAgeSeconds, cfg.secureCookies);
    return res;
  };
};
