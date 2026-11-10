// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { formatCivil } from '@/shared/zoned';
import { agenda, collapse, monthCells } from './month';
import { daysOf } from './range';
import { makeEvent } from '@/shared/calendar/test-utils';

describe('collapse (the "ещё N" rule)', () => {
  it('shows everything when it fits', () => {
    expect(collapse([1, 2, 3], 3)).toEqual({ visible: [1, 2, 3], more: 0 });
    expect(collapse([], 3)).toEqual({ visible: [], more: 0 });
  });

  it('gives one slot to the "more" row, so it hides at least two', () => {
    expect(collapse([1, 2, 3, 4], 3)).toEqual({ visible: [1, 2], more: 2 });
    expect(collapse([1, 2, 3, 4, 5, 6], 3)).toEqual({ visible: [1, 2], more: 4 });
  });

  it('invariants for every size and capacity: visible + more = total, "more" is never exactly 1', () => {
    for (let cap = 1; cap <= 8; cap += 1) {
      for (let n = 0; n <= 30; n += 1) {
        const items = Array.from({ length: n }, (_, i) => i);
        const { visible, more } = collapse(items, cap);
        expect(visible.length + more).toBe(n);
        expect(more).not.toBe(1);
        expect(visible.length + (more > 0 ? 1 : 0)).toBeLessThanOrEqual(cap);
        expect(visible).toEqual(items.slice(0, visible.length)); // keeps order
      }
    }
  });

  it('a capacity below 1 behaves as 1', () => {
    expect(collapse([1, 2], 0)).toEqual({ visible: [], more: 2 });
  });
});

describe('monthCells', () => {
  const days = daysOf('month', { y: 2026, m: 11, d: 10 }, 1); // Oct 26 .. Dec 6 (Mon start, 6 weeks)
  const cells = (events: ReturnType<typeof makeEvent>[], cap = 3) =>
    monthCells(days, { y: 2026, m: 11 }, events, 'UTC', cap);
  const cellOf = (list: ReturnType<typeof cells>, iso: string) =>
    list.find((c) => formatCivil(c.date) === iso)!;

  it('marks days of other months and lists events on their day only', () => {
    const list = cells([
      makeEvent('2026-11-10T10:00:00Z', '2026-11-10T11:00:00Z', { tzid: 'UTC', title: 'A' }),
    ]);
    expect(list).toHaveLength(42);
    expect(cellOf(list, '2026-10-26').inMonth).toBe(false);
    expect(cellOf(list, '2026-11-10').inMonth).toBe(true);
    expect(cellOf(list, '2026-11-10').items.map((s) => s.event.title)).toEqual(['A']);
    expect(list.filter((c) => c.items.length > 0)).toHaveLength(1);
  });

  it('collapses a busy day: 7 events, capacity 3 -> 2 shown + "5 more" (every event is still counted)', () => {
    const events = Array.from({ length: 7 }, (_, i) =>
      makeEvent(
        `2026-11-10T${String(8 + i).padStart(2, '0')}:00:00Z`,
        `2026-11-10T${String(8 + i).padStart(2, '0')}:30:00Z`,
        { tzid: 'UTC', title: `E${i}`, eventId: `e${i}` },
      ),
    );
    const cell = cellOf(cells(events, 3), '2026-11-10');
    expect(cell.visible.map((s) => s.event.title)).toEqual(['E0', 'E1']);
    expect(cell.more).toBe(5);
    expect(cell.items).toHaveLength(7);
  });

  it('puts all-day and multi-day events first, then timed ones by start time', () => {
    const events = [
      makeEvent('2026-11-10T15:00:00Z', '2026-11-10T16:00:00Z', {
        tzid: 'UTC',
        title: 'late',
        eventId: '1',
      }),
      makeEvent('2026-11-10T08:00:00Z', '2026-11-10T09:00:00Z', {
        tzid: 'UTC',
        title: 'early',
        eventId: '2',
      }),
      makeEvent('2026-11-10T00:00:00Z', '2026-11-11T00:00:00Z', {
        tzid: 'UTC',
        title: 'all-day',
        eventId: '3',
        allDay: true,
      }),
      makeEvent('2026-11-09T20:00:00Z', '2026-11-10T04:00:00Z', {
        tzid: 'UTC',
        title: 'overnight',
        eventId: '4',
      }),
    ];
    expect(cellOf(cells(events), '2026-11-10').items.map((s) => s.event.title)).toEqual([
      'all-day',
      'overnight',
      'early',
      'late',
    ]);
  });

  it('a multi-day event shows on every day it covers', () => {
    const e = makeEvent('2026-11-10T00:00:00Z', '2026-11-13T00:00:00Z', {
      tzid: 'UTC',
      allDay: true,
      title: 'Offsite',
    });
    const withIt = cells([e])
      .filter((c) => c.items.length > 0)
      .map((c) => formatCivil(c.date));
    expect(withIt).toEqual(['2026-11-10', '2026-11-11', '2026-11-12']);
  });

  it('is stable: the same events in any order give the same cells', () => {
    const events = Array.from({ length: 12 }, (_, i) =>
      makeEvent('2026-11-10T09:00:00Z', '2026-11-10T10:00:00Z', {
        tzid: 'UTC',
        eventId: `id${i}`,
        title: `T${i}`,
      }),
    );
    const a = cells(events).map((c) => c.items.map((s) => s.event.key));
    const b = cells([...events].reverse()).map((c) => c.items.map((s) => s.event.key));
    expect(a).toEqual(b);
  });
});

describe('agenda (list view)', () => {
  const from = { y: 2026, m: 11, d: 1 };
  const to = { y: 2026, m: 11, d: 30 };

  it('lists only days that have events, in order, with events sorted inside each day', () => {
    const events = [
      makeEvent('2026-11-12T09:00:00Z', '2026-11-12T10:00:00Z', { tzid: 'UTC', title: 'c' }),
      makeEvent('2026-11-03T14:00:00Z', '2026-11-03T15:00:00Z', { tzid: 'UTC', title: 'b' }),
      makeEvent('2026-11-03T08:00:00Z', '2026-11-03T09:00:00Z', { tzid: 'UTC', title: 'a' }),
    ];
    const list = agenda(events, 'UTC', from, to);
    expect(list.map((d) => formatCivil(d.date))).toEqual(['2026-11-03', '2026-11-12']);
    expect(list[0]!.segments.map((s) => s.event.title)).toEqual(['a', 'b']);
  });

  it('an event that crosses midnight appears on both days, once per day', () => {
    const e = makeEvent('2026-11-03T22:00:00Z', '2026-11-04T02:00:00Z', { tzid: 'UTC' });
    const list = agenda([e], 'UTC', from, to);
    expect(list.map((d) => [formatCivil(d.date), d.segments.length])).toEqual([
      ['2026-11-03', 1],
      ['2026-11-04', 1],
    ]);
  });

  it('puts the evening NY event on the next day for a Tokyo viewer', () => {
    const e = makeEvent('2026-11-13T04:30:00Z', '2026-11-13T05:30:00Z', {
      tzid: 'America/New_York',
    });
    expect(agenda([e], 'Asia/Tokyo', from, to).map((d) => formatCivil(d.date))).toEqual([
      '2026-11-13',
    ]);
    expect(agenda([e], 'America/New_York', from, to).map((d) => formatCivil(d.date))).toEqual([
      '2026-11-12',
      '2026-11-13',
    ]);
  });

  it('clips to the requested window', () => {
    const e = makeEvent('2026-12-03T09:00:00Z', '2026-12-03T10:00:00Z', { tzid: 'UTC' });
    expect(agenda([e], 'UTC', from, to)).toEqual([]);
  });
});
