// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Db } from './client';
import { abort, abortWith, runTx } from './transaction';

const pgError = (code: string, constraint?: string) =>
  Object.assign(new Error(`pg ${code}`), { code, constraint_name: constraint });

/** A stand-in for Drizzle's `db.transaction` that runs the callback and counts attempts. */
const fakeDb = (failures: unknown[]) => {
  let attempts = 0;
  const db = {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      attempts += 1;
      const failure = failures[attempts - 1];
      if (failure) throw failure;
      return fn({});
    },
  } as unknown as Db;
  return { db, attempts: () => attempts };
};

describe('runTx retries', () => {
  it.each(['40P01', '40001'])(
    'retries %s (deadlock / serialization failure) and then succeeds',
    async (code) => {
      const { db, attempts } = fakeDb([pgError(code), pgError(code)]);
      const r = await runTx(db, async () => 'done');
      expect(r).toEqual({ ok: true, value: 'done' });
      expect(attempts()).toBe(3);
    },
  );

  it('gives up after 4 attempts and surfaces the original error (never loops forever)', async () => {
    const { db, attempts } = fakeDb(Array.from({ length: 10 }, () => pgError('40P01')));
    await expect(runTx(db, async () => 'x')).rejects.toMatchObject({ code: '40P01' });
    expect(attempts()).toBe(4);
  });

  it.each([
    ['unique violation', pgError('23505')],
    ['plain error', new Error('boom')],
  ])('does NOT retry %s', async (_n, error) => {
    const { db, attempts } = fakeDb([error, error]);
    await expect(runTx(db, async () => 'x')).rejects.toBe(error);
    expect(attempts()).toBe(1);
  });

  it('an abort() inside the transaction becomes an error result without retrying', async () => {
    const { db, attempts } = fakeDb([]);
    const r = await runTx(db, async () => abort(409, 'VERSION_CONFLICT', { current: 1 }));
    expect(r).toEqual({
      ok: false,
      error: { status: 409, code: 'VERSION_CONFLICT', details: { current: 1 } },
    });
    expect(attempts()).toBe(1);
  });
});

describe('runTx deferred aborts and error mapping', () => {
  it('abortWith runs its callback after the rollback with the db handle', async () => {
    const { db } = fakeDb([]);
    let sawDb: unknown;
    const r = await runTx(db, async () =>
      abortWith(async (d) => {
        sawDb = d;
        return { status: 409, code: 'ROOM_CONFLICT', details: { blockers: [] } };
      }),
    );
    expect(sawDb).toBe(db);
    expect(r).toEqual({
      ok: false,
      error: { status: 409, code: 'ROOM_CONFLICT', details: { blockers: [] } },
    });
  });

  it('mapError turns a database error into an API error; unmapped errors are rethrown', async () => {
    const mapError = (e: unknown) =>
      (e as { code?: string }).code === '23503'
        ? { status: 400, code: 'VALIDATION' as const }
        : null;
    const mapped = await runTx(fakeDb([pgError('23503')]).db, async () => 1, { mapError });
    expect(mapped).toEqual({ ok: false, error: { status: 400, code: 'VALIDATION' } });
    const other = pgError('23505');
    await expect(runTx(fakeDb([other]).db, async () => 1, { mapError })).rejects.toBe(other);
  });
});
