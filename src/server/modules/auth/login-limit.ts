import type { Temporal } from '@js-temporal/polyfill';
import { parseInstant } from '@/shared/time';
import { and, count, desc, eq, gt, lt } from 'drizzle-orm';
import type { Db } from '@/server/core/db';
import { loginFailures } from './schema';

/**
 * Slows password guessing down: after `max` failures for one key within `windowMs`, further attempts
 * for that key are refused until the oldest of those failures is a window old.
 *
 * The counts live in the database, not in the memory of one server process: they survive a restart and
 * are shared by every instance. Keys are `account:<email>` and `ip:<address>` (see the login handler for
 * which clients each of them applies to).
 */
export type LoginLimiter = {
  /** Seconds to wait before another attempt for `key`, or 0 if allowed. */
  retryAfter: (db: Db, key: string, now: Temporal.Instant) => Promise<number>;
  fail: (db: Db, key: string, now: Temporal.Instant) => Promise<void>;
  /** Forgets the failures of `key` (after a successful sign-in). */
  clear: (db: Db, key: string) => Promise<void>;
};

export function createLoginLimiter({
  max,
  windowMs = 15 * 60_000,
}: {
  max: number;
  windowMs?: number;
}): LoginLimiter {
  const windowStart = (now: Temporal.Instant) => now.subtract({ milliseconds: windowMs });
  return {
    async retryAfter(db, key, now) {
      const recent = await db
        .select({ at: loginFailures.at })
        .from(loginFailures)
        .where(and(eq(loginFailures.key, key), gt(loginFailures.at, windowStart(now).toString())))
        .orderBy(desc(loginFailures.at))
        .limit(max);
      if (recent.length < max) return 0;
      // The attempt is allowed again when the max-th most recent failure has left the window.
      const oldest = recent[max - 1]?.at;
      if (!oldest) return 0;
      const until = parseInstant(oldest).epochMilliseconds + windowMs;
      return Math.max(1, Math.ceil((until - now.epochMilliseconds) / 1000));
    },
    async fail(db, key, now) {
      await db.insert(loginFailures).values({ key, at: now.toString() });
      // Housekeeping: nothing older than the window can matter any more.
      await db.delete(loginFailures).where(lt(loginFailures.at, windowStart(now).toString()));
    },
    async clear(db, key) {
      await db.delete(loginFailures).where(eq(loginFailures.key, key));
    },
  };
}

export const failuresOf = async (db: Db, key: string): Promise<number> => {
  const [row] = await db
    .select({ n: count() })
    .from(loginFailures)
    .where(eq(loginFailures.key, key));
  return row?.n ?? 0;
};
