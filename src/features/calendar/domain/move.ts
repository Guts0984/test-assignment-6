import {
  addDays,
  diffDays,
  fromLocal,
  localAsUtc,
  localFromUtcMs,
  startOfDay,
  toLocal,
  type Civil,
} from '@/shared/zoned';
import { MINUTES_PER_DAY } from './grid';
import type { CalEvent } from '@/shared/calendar/types';
import type { Segment } from './segments';

/** A wall-clock point on the viewer's grid: a day and minutes since local midnight. */
export type GridPoint = { date: Civil; minutes: number };

export const instantAt = ({ date, minutes }: GridPoint, tz: string): number =>
  fromLocal({ ...date, h: Math.floor(minutes / 60), mi: Math.floor(minutes % 60), s: 0 }, tz);

export type Times = { start: number; end: number };

/**
 * Moving an event: its start lands on the target wall-clock point; the real duration is kept (an event
 * dropped over a DST change keeps its length instead of stretching with the wall clock). All-day events
 * keep their number of days and use the event's own zone for the dates.
 */
export function movedTimes(
  event: Pick<CalEvent, 'start' | 'end' | 'allDay' | 'tzid'>,
  target: GridPoint,
  viewerTz: string,
): Times {
  if (event.allDay) {
    const days = diffDays(
      { ...toLocal(event.start, event.tzid) },
      { ...toLocal(event.end, event.tzid) },
    );
    const start = startOfDay(target.date, event.tzid);
    return { start, end: startOfDay(addDays(target.date, Math.max(1, days)), event.tzid) };
  }
  const start = instantAt(target, viewerTz);
  return { start, end: start + (event.end - event.start) };
}

/**
 * Moving one DAY-SEGMENT of a meeting that runs past midnight. What is dragged is a piece of the
 * event (e.g. the part on the second day), so the whole event shifts by the distance that piece moved:
 * its length is kept and both parts stay joined. (Placing the event's START at the drop point, as for a
 * single-day event, would push the event later by everything that comes before the dragged piece.)
 */
export function movedBySegment(
  event: Pick<CalEvent, 'start' | 'end' | 'allDay' | 'tzid'>,
  segment: Pick<Segment, 'date' | 'startMin'>,
  target: GridPoint,
  viewerTz: string,
): Times {
  if (event.allDay) return movedTimes(event, target, viewerTz);
  const delta =
    instantAt(target, viewerTz) -
    instantAt({ date: segment.date, minutes: segment.startMin }, viewerTz);
  return { start: event.start + delta, end: event.end + delta };
}

/**
 * A keyboard drop of one segment: where it ended up (column and minutes), possibly with a new length.
 *  - Moved: the whole event shifts by that distance (see movedBySegment).
 *  - Lengthened or shortened: only the END changes, and only on the last piece of the event; a piece
 *    that continues into the next day has no end of its own to move, so that part is ignored.
 */
export function changedBySegment(
  event: Pick<CalEvent, 'start' | 'end' | 'allDay' | 'tzid'>,
  segment: Pick<Segment, 'date' | 'startMin' | 'endMin' | 'continuesAfter'>,
  target: { date: Civil; startMin: number; endMin: number },
  viewerTz: string,
  minMinutes = 15,
): Times {
  if (event.allDay) return rangeTimes(target.date, target.startMin, target.endMin, viewerTz);
  const moved = movedBySegment(
    event,
    segment,
    { date: target.date, minutes: target.startMin },
    viewerTz,
  );
  const lengthChanged = target.endMin - target.startMin !== segment.endMin - segment.startMin;
  if (!lengthChanged || segment.continuesAfter) return moved;
  const end =
    target.endMin >= MINUTES_PER_DAY
      ? startOfDay(addDays(target.date, 1), viewerTz)
      : instantAt({ date: target.date, minutes: target.endMin }, viewerTz);
  return { start: moved.start, end: Math.max(end, moved.start + minMinutes * 60_000) };
}

/** Resizing: the end lands on the target wall-clock point; it must stay at least `minMinutes` after the start. */
export function resizedTimes(
  event: Pick<CalEvent, 'start' | 'end'>,
  target: GridPoint,
  viewerTz: string,
  minMinutes = 15,
): Times {
  const end = instantAt(target, viewerTz);
  return { start: event.start, end: Math.max(end, event.start + minMinutes * 60_000) };
}

/** Wall-clock range -> instants, for a range dragged on an empty grid. */
export function rangeTimes(date: Civil, startMin: number, endMin: number, tz: string): Times {
  const start = instantAt({ date, minutes: startMin }, tz);
  const end =
    endMin >= MINUTES_PER_DAY
      ? startOfDay(addDays(date, 1), tz)
      : instantAt({ date, minutes: endMin }, tz);
  return { start, end };
}

/**
 * Moving ONE occurrence of a series with scope "all" really means moving the whole series: the server
 * wants the new times of the series' FIRST occurrence. Shift it by the same wall-clock delta (in the
 * event's own zone, so "Monday 9:00" stays a wall-clock rule across DST) and keep the real duration.
 */
export function shiftSeriesTimes(args: {
  master: Times;
  oldOccurrenceStart: number;
  newOccurrenceStart: number;
  /** With both ends given, a change of the occurrence's LENGTH is applied to the series too (a resize). */
  oldOccurrenceEnd?: number;
  newOccurrenceEnd?: number;
  tzid: string;
}): Times {
  const { master, oldOccurrenceStart, newOccurrenceStart, tzid } = args;
  const wall = (ms: number) => localAsUtc(toLocal(ms, tzid));
  const delta = wall(newOccurrenceStart) - wall(oldOccurrenceStart);
  const start = fromLocal(localFromUtcMs(wall(master.start) + delta), tzid);
  const lengthChange =
    args.oldOccurrenceEnd !== undefined && args.newOccurrenceEnd !== undefined
      ? args.newOccurrenceEnd - newOccurrenceStart - (args.oldOccurrenceEnd - oldOccurrenceStart)
      : 0;
  return { start, end: start + (master.end - master.start) + lengthChange };
}
