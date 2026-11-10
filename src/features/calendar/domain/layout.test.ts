// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { layoutColumn, MIN_VISUAL_MINUTES, type LayoutItem, type Placed } from './layout';

const rand = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const item = (id: string, startMin: number, endMin: number): LayoutItem => ({
  id,
  startMin,
  endMin,
});
const byId = (placed: Placed[]) => Object.fromEntries(placed.map((p) => [p.id, p]));
const eff = (i: LayoutItem) => Math.max(i.endMin, i.startMin + MIN_VISUAL_MINUTES);
const overlap = (a: LayoutItem, b: LayoutItem) => a.startMin < eff(b) && b.startMin < eff(a);

function randomItems(n: number, seed: number): LayoutItem[] {
  const r = rand(seed);
  return Array.from({ length: n }, (_, i) => {
    const start = Math.floor(r() * 96) * 15; // 15-minute grid, plenty of ties
    const len = (Math.floor(r() * 8) + 1) * 15;
    return item(`e${i}`, start, Math.min(1440, start + len));
  });
}

/** Independent check of optimality: the most events that are on screen at the same instant. */
function maxConcurrency(items: LayoutItem[]): number {
  const points = [...new Set(items.flatMap((i) => [i.startMin, eff(i)]))].sort((a, b) => a - b);
  return Math.max(
    0,
    ...points.map((t) => items.filter((i) => i.startMin <= t && t < eff(i)).length),
  );
}

describe('layoutColumn: basics', () => {
  it('nothing in, nothing out; a lone event takes the whole width', () => {
    expect(layoutColumn([])).toEqual([]);
    expect(layoutColumn([item('a', 540, 600)])).toEqual([{ id: 'a', col: 0, span: 1, cols: 1 }]);
  });

  it('5 events that all overlap sit side by side: 5 distinct sub-columns, none on top of another (acceptance #6)', () => {
    const items = ['a', 'b', 'c', 'd', 'e'].map((id, i) => item(id, 600 + i * 15, 720 + i * 10));
    const placed = layoutColumn(items);
    expect(placed.map((p) => p.cols)).toEqual([5, 5, 5, 5, 5]);
    expect(new Set(placed.map((p) => p.col)).size).toBe(5);
    expect(placed.every((p) => p.span === 1)).toBe(true);
  });

  it('events that only touch (end == start) do not overlap and share the full width', () => {
    const p = byId(layoutColumn([item('a', 540, 600), item('b', 600, 660), item('c', 660, 720)]));
    for (const id of ['a', 'b', 'c']) expect(p[id]).toEqual({ id, col: 0, span: 1, cols: 1 });
  });

  it('a chain A-B-C (A and C do not overlap) reuses the first sub-column for C', () => {
    const p = byId(layoutColumn([item('a', 540, 620), item('b', 600, 680), item('c', 660, 720)]));
    expect([p.a?.col, p.b?.col, p.c?.col]).toEqual([0, 1, 0]);
    expect([p.a?.cols, p.b?.cols, p.c?.cols]).toEqual([2, 2, 2]);
  });

  it('an event widens over free sub-columns to its right (longer events are placed first)', () => {
    // c is the longest so it takes column 0; a and b share 9:00-10:00 in columns 1 and 2.
    const items = [
      item('a', 540, 600),
      item('b', 540, 600),
      item('c', 540, 720),
      item('d', 600, 660),
    ];
    const p = byId(layoutColumn(items));
    expect(p.c).toMatchObject({ col: 0, span: 1, cols: 3 });
    expect(p.d).toMatchObject({ col: 1, span: 2 }); // columns 1 and 2 are free at 10:00-11:00
    expect(p.d!.col + p.d!.span).toBe(p.d!.cols);
  });

  it('widening stops at a sub-column that is busy at that time', () => {
    const items = [
      item('a', 540, 600),
      item('b', 540, 600),
      item('c', 540, 720),
      item('d', 600, 660),
      item('e', 600, 660),
    ];
    const p = byId(layoutColumn(items));
    expect(p.d).toMatchObject({ col: 1, span: 1 });
    expect(p.e).toMatchObject({ col: 2, span: 1 });
  });

  it('a long event does not widen over a column it overlaps in time', () => {
    const p = byId(layoutColumn([item('long', 540, 720), item('x', 600, 660)]));
    expect(p.long).toMatchObject({ col: 0, span: 1, cols: 2 });
    expect(p.x).toMatchObject({ col: 1, span: 1 });
  });

  it('identical events are ordered by id, so the result never depends on input order', () => {
    const a = layoutColumn([item('b', 540, 600), item('a', 540, 600), item('c', 540, 600)]);
    const b = layoutColumn([item('c', 540, 600), item('a', 540, 600), item('b', 540, 600)]);
    expect(byId(a)).toEqual(byId(b));
    expect(byId(a).a?.col).toBe(0);
    expect(byId(a).b?.col).toBe(1);
    expect(byId(a).c?.col).toBe(2);
  });

  it('events shorter than the minimum drawn height count as that tall (they would overlap on screen)', () => {
    const p = byId(layoutColumn([item('a', 540, 545), item('b', 550, 555)])); // 5 min each, 10 min apart
    expect(p.a?.col).not.toBe(p.b?.col);
    const far = byId(layoutColumn([item('a', 540, 545), item('b', 555, 560)])); // 15 min apart: no visual overlap
    expect(far.a).toMatchObject({ col: 0, cols: 1 });
    expect(far.b).toMatchObject({ col: 0, cols: 1 });
    // zero-length events do not vanish or crash
    expect(layoutColumn([item('z', 600, 600)])).toHaveLength(1);
  });
});

describe('layoutColumn: properties over random data', () => {
  const seeds = Array.from({ length: 40 }, (_, i) => i + 1);

  it.each(seeds)('seed %i: events that overlap in time never overlap on screen', (seed) => {
    const items = randomItems(60, seed);
    const p = byId(layoutColumn(items));
    for (let i = 0; i < items.length; i += 1) {
      for (let j = i + 1; j < items.length; j += 1) {
        const [a, b] = [items[i]!, items[j]!];
        if (!overlap(a, b)) continue;
        const [pa, pb] = [p[a.id]!, p[b.id]!];
        const apart = pa.col + pa.span <= pb.col || pb.col + pb.span <= pa.col;
        expect(apart, `${a.id}[${pa.col}+${pa.span}] vs ${b.id}[${pb.col}+${pb.span}]`).toBe(true);
      }
    }
  });

  it.each(seeds)('seed %i: same result for any order of the input (deterministic)', (seed) => {
    const items = randomItems(60, seed);
    const expected = byId(layoutColumn(items));
    const r = rand(seed * 101);
    for (let k = 0; k < 5; k += 1) {
      const shuffled = [...items].sort(() => r() - 0.5);
      expect(byId(layoutColumn(shuffled))).toEqual(expected);
    }
  });

  it.each(seeds)(
    'seed %i: uses no more sub-columns than the most events on screen at once (optimal)',
    (seed) => {
      const items = randomItems(60, seed);
      const placed = layoutColumn(items);
      expect(Math.max(...placed.map((p) => p.col + 1))).toBe(maxConcurrency(items));
      for (const x of placed) {
        expect(x.col + x.span).toBeLessThanOrEqual(x.cols);
        expect(x.span).toBeGreaterThanOrEqual(1);
      }
    },
  );

  it('returns exactly one placement per event', () => {
    const items = randomItems(200, 7);
    const placed = layoutColumn(items);
    expect(new Set(placed.map((p) => p.id)).size).toBe(items.length);
  });

  it('is fast enough for a busy day: 400 mixed events in one column', () => {
    const items = randomItems(400, 11);
    layoutColumn(items); // warm
    const t0 = performance.now();
    layoutColumn(items);
    expect(performance.now() - t0).toBeLessThan(60);
  });
});
