import { cache } from 'react';
import { cookies } from 'next/headers';
import { authDeps } from './deps';
import { findUserBySession, SESSION_COOKIE } from './session';
import type { PublicUser } from './user';

/**
 * The signed-in user for the current request, for server components and layouts (null if anonymous).
 * Cached per request, so layout, page and i18n config can all ask without extra queries.
 */
export const getPageUser = cache(async (): Promise<PublicUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return findUserBySession(authDeps.db(), token, authDeps.config(), authDeps.now());
});
