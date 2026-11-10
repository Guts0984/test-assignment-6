import { setTimeout as sleep } from 'node:timers/promises';
import type { ApiErrorCode } from '../http';
import type { Db } from './client';
import { isRetryable } from './errors';

export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
/** Either the pool or an open transaction: both run queries. */
export type Exec = Db | Tx;

export type ServiceError = { status: number; code: ApiErrorCode; details?: unknown };
export type Result<T> = { ok: true; value: T } | { ok: false; error: ServiceError };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const fail = (status: number, code: ApiErrorCode, details?: unknown): Result<never> => ({
  ok: false,
  error: { status, code, details },
});

type AbortReason =
  | { kind: 'error'; error: ServiceError }
  /** Needs a query to describe the error; it must run AFTER the rollback (see `abortWith`). */
  | { kind: 'deferred'; describe: (db: Db) => Promise<ServiceError> };

const ABORT = Symbol('abort');
type Abort = { [ABORT]: true; reason: AbortReason };
const isAbort = (e: unknown): e is Abort =>
  typeof e === 'object' && e !== null && (e as Partial<Abort>)[ABORT] === true;

/** Rolls the whole transaction back and makes `runTx` return this error. */
export const abort = (status: number, code: ApiErrorCode, details?: unknown): never => {
  throw {
    [ABORT]: true,
    reason: { kind: 'error', error: { status, code, details } },
  } satisfies Abort;
};

/** Like `abort`, but the error is built by a callback that runs once the transaction is rolled back. */
export const abortWith = (describe: (db: Db) => Promise<ServiceError>): never => {
  throw { [ABORT]: true, reason: { kind: 'deferred', describe } } satisfies Abort;
};

export type RunTxOptions = {
  /** Turns a database error into an API error (e.g. a foreign key violation into a 400). */
  mapError?: (error: unknown) => ServiceError | null;
};

const MAX_ATTEMPTS = 4;

/**
 * Runs `fn` in a transaction and returns a Result instead of throwing for expected failures.
 * Deadlocks / serialization failures are retried; anything unexpected is rethrown.
 */
export async function runTx<T>(
  db: Db,
  fn: (tx: Tx) => Promise<T>,
  options: RunTxOptions = {},
): Promise<Result<T>> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return ok(await db.transaction(fn));
    } catch (e) {
      if (isAbort(e)) {
        const error = e.reason.kind === 'error' ? e.reason.error : await e.reason.describe(db);
        return { ok: false, error };
      }
      if (isRetryable(e) && attempt < MAX_ATTEMPTS) {
        await sleep(5 + Math.floor(Math.random() * 25) * attempt);
        continue;
      }
      const mapped = options.mapError?.(e);
      if (mapped) return { ok: false, error: mapped };
      throw e;
    }
  }
}
