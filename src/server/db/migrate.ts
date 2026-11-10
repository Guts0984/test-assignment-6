import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { resolve } from 'node:path';
import postgres from 'postgres';

/** Relative to the process cwd (repo root in dev/tests, /app in Docker) so it also works once bundled. */
export const migrationsFolder = resolve(process.cwd(), 'src/server/db/migrations');

/** Applies pending migrations. Safe to run repeatedly (drizzle tracks applied ones). */
export async function runMigrations(databaseUrl: string): Promise<void> {
  const client = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(client), { migrationsFolder });
  } finally {
    await client.end();
  }
}
