import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, pgErrorInfo, type Db } from '@/server/core/db';
import { testUrl, truncateAll } from '@/server/tools/testing/db';
import { sessions, users } from './schema';

let db: Db;
let close: () => Promise<void>;
let raw: postgres.Sql;

beforeAll(() => {
  ({ db, close } = createDb(testUrl(), 4));
  raw = postgres(testUrl(), { max: 1, onnotice: () => {} });
});
afterAll(async () => {
  await raw.end();
  await close();
});
beforeEach(async () => {
  await truncateAll(raw);
  await db
    .insert(users)
    .values({ email: 'a@x.test', passwordHash: 'h', name: 'A', timezone: 'Europe/Kyiv' });
});

async function expectPgError(p: Promise<unknown>, code: string, constraint: string) {
  try {
    await p;
  } catch (e) {
    expect(pgErrorInfo(e)).toMatchObject({ code, constraint });
    return;
  }
  expect.unreachable(`expected Postgres error ${code}`);
}

describe('users table', () => {
  it('email is unique case-insensitively', async () => {
    await expectPgError(
      db.insert(users).values({ email: 'A@X.TEST', passwordHash: 'h', name: 'Dup' }),
      '23505',
      'users_email_lower_uq',
    );
  });

  it('rejects an unsupported locale', async () => {
    await expectPgError(
      db.insert(users).values({ email: 'b@x.test', passwordHash: 'h', name: 'B', locale: 'de' }),
      '23514',
      'users_locale_chk',
    );
  });
});

describe('sessions table', () => {
  it('rows disappear with their user (cascade)', async () => {
    const [u] = await db.select().from(users).where(eq(users.email, 'a@x.test'));
    await db
      .insert(sessions)
      .values({ id: 'tok', userId: u!.id, expiresAt: '2030-01-01T00:00:00Z' });
    await db.delete(users).where(eq(users.id, u!.id));
    expect(await db.select().from(sessions)).toHaveLength(0);
  });
});
