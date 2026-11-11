import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from './migrate';
import { testUrl } from '@/server/tools/testing/db';

let raw: postgres.Sql;
beforeAll(() => {
  raw = postgres(testUrl(), { max: 1, onnotice: () => {} });
});
afterAll(async () => {
  await raw.end();
});

describe('migrations', () => {
  it('create every table and the btree_gist extension', async () => {
    const tables = await raw`select tablename from pg_tables where schemaname = 'public'`;
    const names = tables.map((t) => t.tablename);
    for (const t of [
      'users',
      'sessions',
      'rooms',
      'events',
      'event_attendees',
      'event_occurrences',
      'login_failures',
    ]) {
      expect(names).toContain(t);
    }
    const ext = await raw`select 1 from pg_extension where extname = 'btree_gist'`;
    expect(ext).toHaveLength(1);
  });

  it('are idempotent: a second run changes nothing and does not throw', async () => {
    const before = await raw`select count(*)::int as n from drizzle.__drizzle_migrations`;
    await runMigrations(testUrl());
    const after = await raw`select count(*)::int as n from drizzle.__drizzle_migrations`;
    expect(after[0]?.n).toBe(before[0]?.n);
    expect(after[0]?.n).toBe(3); // init, room exclusion, login failures
  });
});
