import {
  addDays,
  civilFromDays,
  compareCivil,
  daysFromCivil,
  diffDays,
  toLocal,
  type Civil,
} from '@/shared/zoned';
import { MINUTES_PER_DAY } from './grid';
import type { CalEvent } from '@/shared/calendar/types';

/** The part of an event that falls on one local day of the viewer. */
export type Segment = {
  event: CalEvent;
  date: Civil;
  /** Minutes since local midnight; `endMin` is exclusive (1440 = end of day). */
  startMin: number;
  endMin: number;
  /** The event started on an earlier day / goes on past this day. */
  continuesBefore: boolean;
  continuesAfter: boolean;
  /** All-day events (or whole-day segments) have no time of day. */
  allDay: boolean;
};

const MAX_DAYS = 400; // a runaway guard, not a feature

const minutesOf = (l: { h: number; mi: number; s: number }) => l.h * 60 + l.mi + l.s / 60;
const dateOf = (l: Civil): Civil => ({ y: l.y, m: l.m, d: l.d });

/**
 * Splits an event into per-day segments in the VIEWER's zone `tz`.
 *  - A timed event is placed by the viewer's wall clock: 23:30 New York is 13:30 NEXT day in Tokyo.
 *    One that crosses local midnight becomes one segment per day.
 *  - An all-day event is a DATE range in the event's own zone and shows on those same dates for
 *    everybody (so "Office closed on Mar 29" never slides to Mar 28 or 30).
 * Segments are clipped to the optional inclusive [from, to] day range.
 */
export function segmentsOf(event: CalEvent, tz: string, from?: Civil, to?: Civil): Segment[] {
  const out: Segment[] = [];
  const keep = (date: Civil) =>
    (!from || compareCivil(date, from) >= 0) && (!to || compareCivil(date, to) <= 0);

  if (event.allDay) {
    const first = dateOf(toLocal(event.start, event.tzid));
    // End is an exclusive local midnight; the last covered day is the one before it.
    const last = addDays(dateOf(toLocal(event.end, event.tzid)), -1);
    const lastDate = compareCivil(last, first) < 0 ? first : last;
    const days = Math.min(MAX_DAYS, diffDays(first, lastDate) + 1);
    for (let i = 0; i < days; i += 1) {
      const date = addDays(first, i);
      if (!keep(date)) continue;
      out.push({
        event,
        date,
        startMin: 0,
        endMin: MINUTES_PER_DAY,
        continuesBefore: i > 0,
        continuesAfter: i < days - 1,
        allDay: true,
      });
    }
    return out;
  }

  const startLocal = toLocal(event.start, tz);
  const endLocal = toLocal(event.end, tz);
  const firstDate = dateOf(startLocal);
  // An event ending exactly at local midnight belongs to the day before.
  const endsAtMidnight = endLocal.h === 0 && endLocal.mi === 0 && endLocal.s === 0;
  const lastDate = endsAtMidnight ? addDays(dateOf(endLocal), -1) : dateOf(endLocal);
  const days = Math.min(MAX_DAYS, Math.max(1, diffDays(firstDate, lastDate) + 1));

  for (let i = 0; i < days; i += 1) {
    const date = addDays(firstDate, i);
    if (!keep(date)) continue;
    const isFirst = i === 0;
    const isLast = i === days - 1;
    out.push({
      event,
      date,
      startMin: isFirst ? minutesOf(startLocal) : 0,
      endMin: isLast ? (endsAtMidnight ? MINUTES_PER_DAY : minutesOf(endLocal)) : MINUTES_PER_DAY,
      continuesBefore: !isFirst,
      continuesAfter: !isLast,
      allDay: false,
    });
  }
  return out;
}

const memo = new WeakMap<CalEvent, { sig: string; segments: Segment[] }>();

/**
 * `segmentsOf`, remembered per event object. The calendar edits one event at a time and every other
 * event keeps its identity, so it keeps its segments too: a drop then re-renders one block, not all
 * 2 000 (and does not redo their zone arithmetic).
 */
export function segmentsOfCached(event: CalEvent, tz: string, from: Civil, to: Civil): Segment[] {
  const sig = `${tz}|${daysFromCivil(from)}|${daysFromCivil(to)}`;
  const hit = memo.get(event);
  if (hit && hit.sig === sig) return hit.segments;
  const segments = segmentsOf(event, tz, from, to);
  memo.set(event, { sig, segments });
  return segments;
}

/** The viewer's local day containing the instant `ms`. */
export const dayOf = (ms: number, tz: string): Civil => dateOf(toLocal(ms, tz));

/** Epoch-day key of a civil date, handy as a map key. */
export const dayKey = (c: Civil): number => daysFromCivil(c);
export const civilOfKey = (key: number): Civil => civilFromDays(key);
