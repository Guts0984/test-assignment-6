import type { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '../session';

/** httpOnly + SameSite=Lax; `secure` only when the app is served over https. */
export const setSessionCookie = (
  res: NextResponse,
  token: string,
  maxAge: number,
  secure: boolean,
) =>
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge,
  });
