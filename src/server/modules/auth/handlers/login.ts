import type { NextRequest, NextResponse } from 'next/server';
import { apiError, isSameOrigin, json, parseBody } from '@/server/core/http';
import { authenticate } from '../authenticate';
import type { AuthDeps } from '../guard';
import { createSession, purgeExpiredSessions } from '../session';
import { createLoginLimiter } from '../login-limit';
import { loginSchema } from '../validation';
import { setSessionCookie } from './cookies';

/** The network address of the caller, as far as the proxy in front of us tells (best effort). */
const addressOf = (req: NextRequest): string =>
  req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';

export const makeLoginHandler = (deps: AuthDeps) => {
  // Guessing passwords: 10 failures per e-mail address, 100 per network address, per 15 minutes.
  const byEmail = createLoginLimiter({ max: 10 });
  const byAddress = createLoginLimiter({ max: 100 });
  return async (req: NextRequest): Promise<NextResponse> => {
    if (!isSameOrigin(req)) return apiError(403, 'FORBIDDEN_ORIGIN');
    const body = await parseBody(req, loginSchema);
    if (!body.ok) return body.response;

    const email = body.data.email.trim().toLowerCase();
    const address = addressOf(req);
    const now = deps.now().epochMilliseconds;
    const wait = Math.max(byEmail.retryAfter([email], now), byAddress.retryAfter([address], now));
    if (wait > 0) {
      const res = apiError(429, 'TOO_MANY_ATTEMPTS');
      res.headers.set('retry-after', String(wait));
      return res;
    }

    const db = deps.db();
    const user = await authenticate(db, body.data.email, body.data.password);
    if (!user) {
      byEmail.fail([email], now);
      byAddress.fail([address], now);
      return apiError(401, 'INVALID_CREDENTIALS');
    }
    byEmail.succeed(email);

    const cfg = deps.config();
    await purgeExpiredSessions(db, deps.now());
    const { token, maxAgeSeconds } = await createSession(db, user.id, cfg, deps.now());
    const res = json({ user });
    setSessionCookie(res, token, maxAgeSeconds, cfg.secureCookies);
    return res;
  };
};
