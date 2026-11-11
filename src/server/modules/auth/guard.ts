import type { Temporal } from '@js-temporal/polyfill';
import type { NextRequest, NextResponse } from 'next/server';
import type { Db } from '@/server/core/db';
import { apiError, isSameOrigin } from '@/server/core/http';
import { findUserBySession, SESSION_COOKIE, type SessionConfig } from './session';
import type { PublicUser } from './user';

/** Everything auth needs from the outside world, injected so it is testable. */
export type AuthDeps = {
  db: () => Db;
  config: () => SessionConfig & {
    secureCookies: boolean;
    /** How many reverse proxies of ours sit in front of the app (0 = none: no client address is trusted). */
    trustedProxyHops?: number;
  };
  now: () => Temporal.Instant;
};

export type Authed = { user: PublicUser; now: Temporal.Instant };

export const tokenOf = (req: NextRequest): string | undefined =>
  req.cookies.get(SESSION_COOKIE)?.value;

/** The logged-in user of a request, or null. */
export const currentUser = (deps: AuthDeps, req: NextRequest): Promise<PublicUser | null> =>
  findUserBySession(deps.db(), tokenOf(req), deps.config(), deps.now());

/**
 * The one gate every protected route goes through: refuses cross-origin mutations (403) and
 * anonymous callers (401), otherwise returns the user and the clock to use.
 */
export async function authorize(
  deps: AuthDeps,
  req: NextRequest,
  { mutating }: { mutating: boolean },
): Promise<Authed | NextResponse> {
  if (mutating && !isSameOrigin(req)) return apiError(403, 'FORBIDDEN_ORIGIN');
  const user = await currentUser(deps, req);
  return user ? { user, now: deps.now() } : apiError(401, 'UNAUTHENTICATED');
}

/** Narrowing helper: `authorize` returns either the context or a ready-made error response. */
export const isDenied = (x: Authed | NextResponse): x is NextResponse => 'status' in x;
