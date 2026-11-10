import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

// scrypt from node:crypto: no native dependency to build in Docker. Format: scrypt$N$r$p$salt$hash
const N = 16384;
const R = 8;
const P = 1;
const KEY_LEN = 64;

const derive = (password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LEN, { N: n, r, p }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, N, R, P);
  return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$');
}

/** Returns false (never throws) for wrong passwords and for malformed stored hashes. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [n, r, p] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  const salt = Buffer.from(parts[4] ?? '', 'base64');
  const expected = Buffer.from(parts[5] ?? '', 'base64');
  if (![n, r, p].every(Number.isInteger) || salt.length === 0 || expected.length !== KEY_LEN) {
    return false;
  }
  try {
    const actual = await derive(password, salt, n, r, p);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
