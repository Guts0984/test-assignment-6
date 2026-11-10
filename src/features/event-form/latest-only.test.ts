// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { fakeScheduler } from '@/features/sync/testing';
import { createLatestOnly, debounce } from './latest-only';

const deferred = <T>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
};

describe('createLatestOnly (stale responses never win)', () => {
  it('delivers a lone result', async () => {
    const q = createLatestOnly<string>();
    expect(await q.run(async () => 'a')).toEqual({ stale: false, value: 'a' });
  });

  it('an OLD request that finishes AFTER a newer one is stale, even if it ignores the abort signal', async () => {
    const q = createLatestOnly<string>();
    const first = deferred<string>();
    const second = deferred<string>();
    const r1 = q.run(() => first.promise); // does not look at the signal at all
    const r2 = q.run(() => second.promise);
    second.resolve('new');
    expect(await r2).toEqual({ stale: false, value: 'new' });
    first.resolve('old'); // arrives late
    expect(await r1).toEqual({ stale: true });
  });

  it('the previous request is aborted when a new one starts', async () => {
    const q = createLatestOnly<string>();
    let signal1: AbortSignal | undefined;
    void q.run((s) => ((signal1 = s), new Promise(() => {})));
    void q.run(async () => 'x');
    expect(signal1?.aborted).toBe(true);
  });

  it('an aborted request that rejects is reported as stale, not as an error', async () => {
    const q = createLatestOnly<string>();
    const r1 = q.run(
      (s) =>
        new Promise((_, reject) =>
          s.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          ),
        ),
    );
    void q.run(async () => 'newer');
    expect(await r1).toEqual({ stale: true });
  });

  it('a real failure of the latest request is thrown', async () => {
    const q = createLatestOnly<string>();
    await expect(
      q.run(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });

  it('cancel() makes whatever is in flight stale (e.g. the panel closed)', async () => {
    const q = createLatestOnly<string>();
    const d = deferred<string>();
    const r = q.run(() => d.promise);
    q.cancel();
    d.resolve('late');
    expect(await r).toEqual({ stale: true });
  });

  it('many overlapping requests resolving in random order: only the newest is ever delivered', async () => {
    const q = createLatestOnly<number>();
    const ds = Array.from({ length: 12 }, () => deferred<number>());
    const results = ds.map((d) => q.run(() => d.promise));
    for (const i of [7, 0, 11, 3, 5, 1, 9, 2, 10, 4, 6, 8]) ds[i]!.resolve(i);
    const settled = await Promise.all(results);
    expect(settled.map((r) => (r.stale ? null : r.value))).toEqual([...Array(11).fill(null), 11]);
  });
});

describe('debounce', () => {
  it('runs only the last call, after the quiet period', async () => {
    const time = fakeScheduler();
    const seen: string[] = [];
    const d = debounce((v: string) => void seen.push(v), 250, time.schedule);
    d('a');
    await time.advance(100);
    d('ab');
    await time.advance(100);
    d('abc');
    await time.advance(249);
    expect(seen).toEqual([]);
    await time.advance(1);
    expect(seen).toEqual(['abc']);
  });

  it('cancel drops a pending call and leaves no timer behind', async () => {
    const time = fakeScheduler();
    const seen: string[] = [];
    const d = debounce((v: string) => void seen.push(v), 250, time.schedule);
    d('x');
    d.cancel();
    await time.advance(1000);
    expect(seen).toEqual([]);
    expect(time.pending()).toEqual([]);
  });
});
