/**
 * Guessing passwords is slowed down: after `max` failed sign-ins for one e-mail address (or from one
 * network address) within `windowMs`, further attempts are refused until the oldest failure expires.
 * In memory, per server process: enough to make a guessing run impractical; a shared store would be
 * needed to count across several servers.
 */
export type LoginLimiter = {
  /** Seconds to wait before another attempt for these keys, or 0 if allowed. */
  retryAfter: (keys: readonly string[], now: number) => number;
  fail: (keys: readonly string[], now: number) => void;
  succeed: (key: string) => void;
};

export function createLoginLimiter({
  max = 10,
  windowMs = 15 * 60_000,
  maxKeys = 10_000,
}: { max?: number; windowMs?: number; maxKeys?: number } = {}): LoginLimiter {
  const failures = new Map<string, number[]>();
  const recent = (key: string, now: number): number[] =>
    (failures.get(key) ?? []).filter((t) => now - t < windowMs);

  return {
    retryAfter(keys, now) {
      let wait = 0;
      for (const key of keys) {
        const list = recent(key, now);
        if (list.length >= max) {
          const until = (list[list.length - max] as number) + windowMs;
          wait = Math.max(wait, Math.ceil((until - now) / 1000));
        }
      }
      return wait;
    },
    fail(keys, now) {
      for (const key of keys) {
        failures.set(key, [...recent(key, now), now]);
      }
      // Bounded memory: forget the oldest entries if somebody tries many different addresses.
      if (failures.size > maxKeys) {
        for (const key of [...failures.keys()].slice(0, failures.size - maxKeys))
          failures.delete(key);
      }
    },
    succeed(key) {
      failures.delete(key);
    },
  };
}
