import type { NextRequest, NextResponse } from 'next/server';
import { apiError, isSameOrigin, json } from '@/server/core/http';
import { tokenOf, type AuthDeps } from '../guard';
import { deleteSession } from '../session';
import { setSessionCookie } from './cookies';

export const makeLogoutHandler =
  (deps: AuthDeps) =>
  async (req: NextRequest): Promise<NextResponse> => {
    if (!isSameOrigin(req)) return apiError(403, 'FORBIDDEN_ORIGIN');
    await deleteSession(deps.db(), tokenOf(req), deps.config());
    const res = json({ ok: true });
    setSessionCookie(res, '', 0, deps.config().secureCookies);
    return res;
  };
