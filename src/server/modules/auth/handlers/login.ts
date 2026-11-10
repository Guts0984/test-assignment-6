import type { NextRequest, NextResponse } from 'next/server';
import { apiError, isSameOrigin, json, parseBody } from '@/server/core/http';
import { authenticate } from '../authenticate';
import type { AuthDeps } from '../guard';
import { createSession, purgeExpiredSessions } from '../session';
import { loginSchema } from '../validation';
import { setSessionCookie } from './cookies';

export const makeLoginHandler =
  (deps: AuthDeps) =>
  async (req: NextRequest): Promise<NextResponse> => {
    if (!isSameOrigin(req)) return apiError(403, 'FORBIDDEN_ORIGIN');
    const body = await parseBody(req, loginSchema);
    if (!body.ok) return body.response;

    const db = deps.db();
    const user = await authenticate(db, body.data.email, body.data.password);
    if (!user) return apiError(401, 'INVALID_CREDENTIALS');

    const cfg = deps.config();
    await purgeExpiredSessions(db, deps.now());
    const { token, maxAgeSeconds } = await createSession(db, user.id, cfg, deps.now());
    const res = json({ user });
    setSessionCookie(res, token, maxAgeSeconds, cfg.secureCookies);
    return res;
  };
