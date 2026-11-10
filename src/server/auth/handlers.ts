import type { Temporal } from '@js-temporal/polyfill';
import { eq } from 'drizzle-orm';
import type { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isValidTimeZone } from '@/shared/time';
import type { Db } from '../db/client';
import { users } from '../db/schema';
import { apiError, isSameOrigin, json, parseBody } from '../http';
import { authenticate } from './authenticate';
import {
  createSession,
  deleteSession,
  findUserBySession,
  purgeExpiredSessions,
  SESSION_COOKIE,
  toPublicUser,
  type PublicUser,
  type SessionConfig,
} from './session';

/** Everything handlers need from the outside world, injected so they are testable. */
export type AuthDeps = {
  db: () => Db;
  config: () => SessionConfig & { secureCookies: boolean };
  now: () => Temporal.Instant;
};

const loginSchema = z.strictObject({
  email: z.string().trim().pipe(z.email()),
  password: z.string().min(1).max(200),
});

const profileSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(100),
    timezone: z.string().refine(isValidTimeZone, 'must be an IANA time zone, e.g. Europe/Kyiv'),
    locale: z.enum(['uk', 'en']),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'nothing to update');

const cookieOptions = (secure: boolean) =>
  ({ httpOnly: true, sameSite: 'lax', secure, path: '/' }) as const;

const setSessionCookie = (res: NextResponse, token: string, maxAge: number, secure: boolean) =>
  res.cookies.set(SESSION_COOKIE, token, { ...cookieOptions(secure), maxAge });

export const tokenOf = (req: NextRequest): string | undefined =>
  req.cookies.get(SESSION_COOKIE)?.value;

/** Resolves the logged-in user of a request, or null. Reused by every protected route. */
export const currentUser = (deps: AuthDeps, req: NextRequest): Promise<PublicUser | null> =>
  findUserBySession(deps.db(), tokenOf(req), deps.config(), deps.now());

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

export const makeLogoutHandler =
  (deps: AuthDeps) =>
  async (req: NextRequest): Promise<NextResponse> => {
    if (!isSameOrigin(req)) return apiError(403, 'FORBIDDEN_ORIGIN');
    await deleteSession(deps.db(), tokenOf(req), deps.config());
    const res = json({ ok: true });
    setSessionCookie(res, '', 0, deps.config().secureCookies);
    return res;
  };

export const makeGetMeHandler =
  (deps: AuthDeps) =>
  async (req: NextRequest): Promise<NextResponse> => {
    const user = await currentUser(deps, req);
    return user ? json({ user }) : apiError(401, 'UNAUTHENTICATED');
  };

export const makeUpdateMeHandler =
  (deps: AuthDeps) =>
  async (req: NextRequest): Promise<NextResponse> => {
    if (!isSameOrigin(req)) return apiError(403, 'FORBIDDEN_ORIGIN');
    const user = await currentUser(deps, req);
    if (!user) return apiError(401, 'UNAUTHENTICATED');
    const body = await parseBody(req, profileSchema);
    if (!body.ok) return body.response;

    const [updated] = await deps
      .db()
      .update(users)
      .set(body.data)
      .where(eq(users.id, user.id))
      .returning();
    return json({ user: updated ? toPublicUser(updated) : user });
  };
