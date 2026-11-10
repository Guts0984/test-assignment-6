import type { Temporal } from '@js-temporal/polyfill';
import { and, eq, gt, lte, sql } from 'drizzle-orm';
import { createHmac, randomBytes } from 'node:crypto';
import type { Db } from '../db/client';
import { sessions, users } from '../db/schema';

export const SESSION_COOKIE = 'session';

export type PublicUser = {
  id: string;
  email: string;
  name: string;
  timezone: string;
  locale: string;
};

export type SessionConfig = { secret: string; ttlDays: number };

export const newToken = (): string => randomBytes(32).toString('base64url');

/** The DB stores HMAC(secret, token), so a leaked `sessions` table cannot be replayed as cookies. */
export const sessionIdFor = (token: string, secret: string): string =>
  createHmac('sha256', secret).update(token).digest('hex');

export const toPublicUser = (u: PublicUser): PublicUser => ({
  id: u.id,
  email: u.email,
  name: u.name,
  timezone: u.timezone,
  locale: u.locale,
});

export async function createSession(
  db: Db,
  userId: string,
  cfg: SessionConfig,
  now: Temporal.Instant,
): Promise<{ token: string; maxAgeSeconds: number }> {
  const token = newToken();
  const expiresAt = now.add({ hours: 24 * cfg.ttlDays });
  await db.insert(sessions).values({
    id: sessionIdFor(token, cfg.secret),
    userId,
    expiresAt: expiresAt.toString(),
  });
  return { token, maxAgeSeconds: cfg.ttlDays * 86_400 };
}

/** The user for a cookie token, or null if unknown, tampered or expired (expiry instant is exclusive). */
export async function findUserBySession(
  db: Db,
  token: string | undefined,
  cfg: SessionConfig,
  now: Temporal.Instant,
): Promise<PublicUser | null> {
  if (!token) return null;
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      timezone: users.timezone,
      locale: users.locale,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(eq(sessions.id, sessionIdFor(token, cfg.secret)), gt(sessions.expiresAt, now.toString())),
    )
    .limit(1);
  return row ?? null;
}

export async function deleteSession(
  db: Db,
  token: string | undefined,
  cfg: SessionConfig,
): Promise<void> {
  if (!token) return;
  await db.delete(sessions).where(eq(sessions.id, sessionIdFor(token, cfg.secret)));
}

export async function purgeExpiredSessions(db: Db, now: Temporal.Instant): Promise<void> {
  await db.delete(sessions).where(lte(sessions.expiresAt, now.toString()));
}

export const findUserByEmail = (db: Db, email: string) =>
  db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = lower(${email})`)
    .limit(1)
    .then((rows) => rows[0] ?? null);
