import postgres from 'postgres';
import { runMigrations } from '@/server/core/db/migrate';
import { testConnectionParts } from './db';

/** Recreates the test database from scratch and applies ALL migrations (so they are tested too). */
export default async function setup(): Promise<void> {
  try {
    process.loadEnvFile('.env');
  } catch {
    // .env is optional if variables are already in the environment (CI).
  }
  const { adminUrl, testDbName, testUrl } = testConnectionParts();
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {}, connect_timeout: 5 });
  try {
    await admin.unsafe(`drop database if exists ${testDbName} with (force)`);
    await admin.unsafe(`create database ${testDbName}`);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'CONNECT_TIMEOUT') {
      throw new Error(
        `Integration tests need Postgres, but it is not reachable (${code}). ` +
          'Start it with `pnpm db:up` (requires .env: cp .env.example .env). ' +
          'Unit tests only: `pnpm test:unit`.',
        { cause: error },
      );
    }
    throw error;
  } finally {
    await admin.end();
  }
  await runMigrations(testUrl);
}
