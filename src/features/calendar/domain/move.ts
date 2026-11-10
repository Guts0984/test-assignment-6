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
  tzid: string;
}): Times {
  const { master, oldOccurrenceStart, newOccurrenceStart, tzid } = args;
  const wall = (ms: number) => localAsUtc(toLocal(ms, tzid));
  const delta = wall(newOccurrenceStart) - wall(oldOccurrenceStart);
  const start = fromLocal(localFromUtcMs(wall(master.start) + delta), tzid);
  return { start, end: start + (master.end - master.start) };
}
