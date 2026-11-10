export type PgErrorInfo = { code?: string; constraint?: string };

/** Postgres error code/constraint, looking through Drizzle's DrizzleQueryError wrapper. */
export function pgErrorInfo(e: unknown): PgErrorInfo {
  const err = e as { code?: string; constraint_name?: string; cause?: unknown } | null;
  if (!err || typeof err !== 'object') return {};
  if (typeof err.code === 'string' && err.code.length === 5) {
    return { code: err.code, constraint: err.constraint_name };
  }
  return err.cause ? pgErrorInfo(err.cause) : {};
}

/** 23P01 exclusion_violation: the room is already booked for that time. */
export const isRoomClash = (e: unknown): boolean => pgErrorInfo(e).code === '23P01';
/** 40P01 deadlock_detected / 40001 serialization_failure: safe to retry the transaction. */
export const isRetryable = (e: unknown): boolean => {
  const { code } = pgErrorInfo(e);
  return code === '40P01' || code === '40001';
};
