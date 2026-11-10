import { Temporal } from '@js-temporal/polyfill';
import { getEnv } from '@/server/core/env';
import { seedIfEmpty } from './seed/seed';
import { createDb } from '@/server/core/db';
import { runMigrations } from '@/server/core/db/migrate';

/** Docker entrypoint step: migrate, then seed once. Idempotent; safe on every container start. */
async function run(): Promise<void> {
  const env = getEnv();
  console.log('[bootstrap] applying migrations');
  await runMigrations(env.DATABASE_URL);

  const { db, close } = createDb(env.DATABASE_URL, 2);
  try {
    const result = await seedIfEmpty(db, {
      now: Temporal.Now.instant(),
      password: env.SEED_USER_PASSWORD,
    });
    console.log(
      result.seeded
        ? `[bootstrap] seeded: ${result.users} users, ${result.rooms} rooms, ${result.events} events, ${result.occurrences} occurrences`
        : '[bootstrap] already seeded, skipping',
    );
  } finally {
    await close();
  }
}

run().catch((error: unknown) => {
  console.error('[bootstrap] failed', error);
  process.exit(1);
});
