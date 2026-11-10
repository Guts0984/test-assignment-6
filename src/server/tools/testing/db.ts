import postgres from 'postgres';

/**
 * Integration tests run against a REAL Postgres (the constraints are the point).
 * Connection comes from the POSTGRES_* vars in .env; the host defaults to localhost
 * because .env.example's host (`postgres`) only resolves inside docker compose.
 */
/**
 * Every test run gets its OWN database (named by global setup, which publishes the name here), so two
 * runs at the same time (two terminals, watch mode, CI jobs sharing a server) cannot drop the database
 * from under each other. Set TEST_DB_NAME to pin one by hand.
 */
export const testDbName = (): string => process.env.TEST_DB_NAME ?? 'calendar_test';

export function testConnectionParts() {
  const host = process.env.TEST_DB_HOST ?? 'localhost';
  const port = process.env.POSTGRES_PORT ?? '5432';
  const user = process.env.POSTGRES_USER ?? 'calendar';
  const password = process.env.POSTGRES_PASSWORD;
  if (!password) throw new Error('POSTGRES_PASSWORD is not set. Run: cp .env.example .env');
  const enc = encodeURIComponent;
  const base = `postgres://${enc(user)}:${enc(password)}@${host}:${port}`;
  return {
    adminUrl: `${base}/postgres`,
    testDbName: testDbName(),
    testUrl: `${base}/${testDbName()}`,
  };
}

export const testUrl = (): string => testConnectionParts().testUrl;

/** Empties every application table (keeps the schema and the drizzle journal). */
export async function truncateAll(sql: postgres.Sql): Promise<void> {
  const tables =
    await sql`select quote_ident(tablename) as name from pg_tables where schemaname = 'public'`;
  if (tables.length === 0) return;
  await sql.unsafe(
    `truncate table ${tables.map((t) => t.name).join(', ')} restart identity cascade`,
  );
}
