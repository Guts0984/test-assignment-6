import { eq, sql } from 'drizzle-orm';
import type { Db } from '@/server/core/db';
import { users } from './schema';

/** What the API (and the browser) may know about a user. Never includes the password hash. */
export type PublicUser = {
  id: string;
  email: string;
  name: string;
  timezone: string;
  locale: string;
};

export const toPublicUser = (u: PublicUser): PublicUser => ({
  id: u.id,
  email: u.email,
  name: u.name,
  timezone: u.timezone,
  locale: u.locale,
});

export const findUserByEmail = (db: Db, email: string) =>
  db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = lower(${email})`)
    .limit(1)
    .then((rows) => rows[0] ?? null);

export type ProfileChanges = Partial<Pick<PublicUser, 'name' | 'timezone' | 'locale'>>;

export async function updateProfile(
  db: Db,
  userId: string,
  changes: ProfileChanges,
): Promise<PublicUser | null> {
  const [row] = await db.update(users).set(changes).where(eq(users.id, userId)).returning();
  return row ? toPublicUser(row) : null;
}
