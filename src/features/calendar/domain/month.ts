import type { Civil } from '@/shared/zoned';
import { civilOfKey, dayKey, segmentsOf, type Segment } from './segments';
import type { CalEvent } from '@/shared/calendar/types';

export type MonthCell = {
  date: Civil;
  inMonth: boolean;
  /** Everything on this day, in display order. */
  items: Segment[];
  /** What fits in the cell. */
  visible: Segment[];
  /** How many more there are: rendered as "ещё N" / "N more". */
  more: number;
};

/** All-day and multi-day events first, then by start time, then by title/key so the order is stable. */
const bySeverity = (a: Segment, b: Segment): number => {
  const bar = (s: Segment) => (s.allDay || s.continuesBefore || s.continuesAfter ? 0 : 1);
  return (
    bar(a) - bar(b) ||
    a.startMin - b.startMin ||
    b.event.end - b.event.start - (a.event.end - a.event.start) ||
    (a.event.key < b.event.key ? -1 : a.event.key > b.event.key ? 1 : 0)
  );
};

/**
 * How many entries a cell shows. If everything fits, all of it. Otherwise one slot is given to the
 * "N more" row, so `visible + more` always equals the total and "1 more" is never shown (that one
 * event could have taken the slot instead).
 */
export function collapse<T>(items: readonly T[], capacity: number): { visible: T[]; more: number } {
  const cap = Math.max(1, Math.floor(capacity));
  if (items.length <= cap) return { visible: [...items], more: 0 };
  const shown = cap - 1;
  return { visible: items.slice(0, shown), more: items.length - shown };
}

export function monthCells(
  days: readonly Civil[],
  month: { y: number; m: number },
  events: readonly CalEvent[],
  tz: string,
  capacity: number,
): MonthCell[] {
  const first = days[0] as Civil;
  const last = days[days.length - 1] as Civil;
  const perDay = new Map<number, Segment[]>();
  for (const event of events) {
    for (const seg of segmentsOf(event, tz, first, last)) {
      const key = dayKey(seg.date);
      perDay.set(key, [...(perDay.get(key) ?? []), seg]);
    }
  }
  return days.map((date) => {
    const items = (perDay.get(dayKey(date)) ?? []).sort(bySeverity);
    const { visible, more } = collapse(items, capacity);
    return { date, inMonth: date.y === month.y && date.m === month.m, items, visible, more };
  });
}

/** A day-by-day agenda: only days that have something, oldest first. Multi-day events appear on each day. */
export function agenda(
  events: readonly CalEvent[],
  tz: string,
  from: Civil,
  to: Civil,
): { date: Civil; segments: Segment[] }[] {
  const perDay = new Map<number, Segment[]>();
  for (const event of events) {
    for (const seg of segmentsOf(event, tz, from, to)) {
      const key = dayKey(seg.date);
      perDay.set(key, [...(perDay.get(key) ?? []), seg]);
    }
  }
  return [...perDay.entries()]
    .sort(([a], [b]) => a - b)
    .map(([key, segments]) => ({ date: civilOfKey(key), segments: segments.sort(bySeverity) }));
}
