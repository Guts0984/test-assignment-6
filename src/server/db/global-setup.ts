import postgres from 'postgres';
import { runMigrations } from './migrate';
import { testConnectionParts } from './test-utils';

/** Recreates the test database from scratch and applies ALL migrations (so they are tested too). */
export default async function setup(): Promise<void> {
  try {
    process.loadEnvFile('.env');
  } catch {
    // .env is optional if variables are already in the environment (CI).
  }
  const { adminUrl, testDbName, testUrl } = testConnectionParts();
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`drop database if exists ${testDbName} with (force)`);
    await admin.unsafe(`create database ${testDbName}`);
  } finally {
    await admin.end();
  }
  await runMigrations(testUrl);
}
