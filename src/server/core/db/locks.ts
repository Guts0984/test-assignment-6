import { sql } from 'drizzle-orm';
import type { Exec } from './transaction';

/**
 * Takes transaction-scoped advisory locks on the given keys, in sorted order, so two
 * transactions that need the same keys queue up instead of deadlocking.
 * Use it to serialize writers of one resource (e.g. all bookings of one room).
 */
export async function advisoryLocks(tx: Exec, keys: string[]): Promise<void> {
  for (const key of [...new Set(keys)].sort()) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
  }
}
