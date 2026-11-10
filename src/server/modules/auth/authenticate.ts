import type { Db } from '@/server/core/db';
import { hashPassword, verifyPassword } from './password';
import { findUserByEmail, toPublicUser, type PublicUser } from './user';

let dummyHash: Promise<string> | undefined;

/**
 * Email + password check. For an unknown email we still verify against a dummy hash so the
 * response time does not reveal which emails exist.
 */
export async function authenticate(
  db: Db,
  email: string,
  password: string,
): Promise<PublicUser | null> {
  const user = await findUserByEmail(db, email);
  if (!user) {
    dummyHash ??= hashPassword('not-a-real-password');
    await verifyPassword(password, await dummyHash);
    return null;
  }
  return (await verifyPassword(password, user.passwordHash)) ? toPublicUser(user) : null;
}
