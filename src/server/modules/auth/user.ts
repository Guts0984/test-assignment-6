import { eq, sql } from 'drizzle-orm';
import type { Db } from '@/server/core/db';
import type { DirectoryUser, PublicUser } from '@/shared/contracts';
import { users } from './schema';

export type { PublicUser };

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

export type { DirectoryUser };

/** Everyone in the office, for the participants picker. */
export const listUsers = (db: Db): Promise<DirectoryUser[]> =>
  db
    .select({ id: users.id, name: users.name, email: users.email, timezone: users.timezone })
    .from(users)
    .orderBy(users.name);
