import type { Db } from '../db/client';
import { hashPassword, verifyPassword } from './password';
import { findUserByEmail, toPublicUser, type PublicUser } from './session';

let dummyHash: Promise<string> | undefined;

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
