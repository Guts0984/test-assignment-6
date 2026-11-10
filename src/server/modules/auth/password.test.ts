// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password';

describe('password hashing', () => {
  it('accepts the right password and rejects wrong ones (incl. case and whitespace)', async () => {
    const h = await hashPassword('demo1234');
    expect(await verifyPassword('demo1234', h)).toBe(true);
    expect(await verifyPassword('Demo1234', h)).toBe(false);
    expect(await verifyPassword('demo1234 ', h)).toBe(false);
    expect(await verifyPassword('', h)).toBe(false);
  });

  it('salts: same password hashes differently, both verify', async () => {
    const [a, b] = await Promise.all([hashPassword('x'.repeat(8)), hashPassword('x'.repeat(8))]);
    expect(a).not.toBe(b);
    expect(await verifyPassword('x'.repeat(8), a)).toBe(true);
    expect(await verifyPassword('x'.repeat(8), b)).toBe(true);
  });

  it.each([
    '',
    'garbage',
    'scrypt$a$b$c$d$e',
    'bcrypt$1$2$3$4$5',
    'scrypt$16384$8$1$$',
    'scrypt$0$0$0$AAAA$AAAA',
  ])('returns false instead of throwing for malformed hash %j', async (bad) => {
    await expect(verifyPassword('demo1234', bad)).resolves.toBe(false);
  });

  it('handles unicode passwords', async () => {
    const h = await hashPassword('пароль🔑123');
    expect(await verifyPassword('пароль🔑123', h)).toBe(true);
    expect(await verifyPassword('пароль🔑124', h)).toBe(false);
  });
});
