import type { Segment } from '../domain/segments';
import { dayKey } from '../domain/segments';

export type Split = { timed: Segment[]; allDay: Segment[] };
const EMPTY: Split = { timed: [], allDay: [] };

/** Groups segments by an arbitrary key (a day, or a room), separating all-day ones. */
export function groupSegments(
  segments: readonly Segment[],
  keyOf: (s: Segment) => string | number,
): Map<string | number, Split> {
  const out = new Map<string | number, Split>();
  for (const s of segments) {
    const k = keyOf(s);
    const bucket = out.get(k) ?? { timed: [], allDay: [] };
    (s.allDay ? bucket.allDay : bucket.timed).push(s);
    out.set(k, bucket);
  }
  return out;
}

export const byDay = (s: Segment): number => dayKey(s.date);
export const empty = (): Split => EMPTY;
