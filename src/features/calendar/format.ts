import {
  dayOfWeek,
  formatClock,
  toLocal,
  type Civil,
  type ClockStyle,
  type TimeLabels,
} from '@/shared/zoned';
import type { View } from './domain/range';

/** The words the formatters need, taken from the message catalog (`weekdays`, `months`, `time`). */
export type Names = {
  weekdayShort: Record<string, string>;
  weekdayLong: Record<string, string>;
  monthLong: Record<string, string>;
  monthShort: Record<string, string>;
  /** Month in the genitive case (uk: "9 листопада"); equals monthLong in English. */
  monthGenitive: Record<string, string>;
  time: TimeLabels;
};

const name = (table: Record<string, string>, n: number) => table[String(n)] ?? String(n);

/** `Mon 9` / `Пн 9`: column header of a day. */
export const dayHeading = (date: Civil, names: Names): { weekday: string; day: number } => ({
  weekday: name(names.weekdayShort, dayOfWeek(date)),
  day: date.d,
});

/** `Monday, November 9, 2026` / `понеділок, 9 листопада 2026`. */
export function longDate(date: Civil, locale: string, names: Names): string {
  const weekday = name(names.weekdayLong, dayOfWeek(date));
  return locale === 'uk'
    ? `${weekday}, ${date.d} ${name(names.monthGenitive, date.m)} ${date.y}`
    : `${weekday}, ${name(names.monthLong, date.m)} ${date.d}, ${date.y}`;
}

/** The title of the visible range in the toolbar. */
export function rangeTitle(
  view: View,
  days: readonly Civil[],
  locale: string,
  names: Names,
): string {
  const first = days[0] as Civil;
  const last = days[days.length - 1] as Civil;
  if (view === 'day') return longDate(first, locale, names);
  if (view === 'month')
    return `${capitalize(name(names.monthLong, first.m === last.m ? first.m : mid(days).m))} ${mid(days).y}`;
  const sameMonth = first.y === last.y && first.m === last.m;
  const uk = locale === 'uk';
  if (sameMonth) {
    return uk
      ? `${first.d} – ${last.d} ${name(names.monthGenitive, first.m)} ${first.y}`
      : `${name(names.monthShort, first.m)} ${first.d} – ${last.d}, ${first.y}`;
  }
  const part = (c: Civil) =>
    uk ? `${c.d} ${name(names.monthGenitive, c.m)}` : `${name(names.monthShort, c.m)} ${c.d}`;
  const withYear = (text: string, year: number) => (uk ? `${text} ${year}` : `${text}, ${year}`);
  return first.y === last.y
    ? withYear(`${part(first)} – ${part(last)}`, last.y)
    : `${withYear(part(first), first.y)} – ${withYear(part(last), last.y)}`;
}

/** The month a month-grid belongs to is the one most of its days are in: its middle day. */
const mid = (days: readonly Civil[]): Civil => days[Math.floor(days.length / 2)] as Civil;
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** `9:30 AM` / `09:30` of an instant in a zone, by the viewer's clock style. */
export function timeOf(ms: number, tz: string, style: ClockStyle, labels: TimeLabels): string {
  const l = toLocal(ms, tz);
  return formatClock(l.h * 60 + l.mi, style, labels);
}

/** `9:30 – 10:15 AM`-like range, written as two full times so it stays unambiguous for screen readers. */
export const timeRange = (
  start: number,
  end: number,
  tz: string,
  style: ClockStyle,
  labels: TimeLabels,
): string => `${timeOf(start, tz, style, labels)} – ${timeOf(end, tz, style, labels)}`;

/**
 * A stable colour per room: the same room always gets the same hue, spread over the colour wheel with
 * the golden angle so 50 rooms stay distinguishable. Only the hue is chosen here; lightness comes from
 * CSS variables so dark mode works.
 */
export function roomHue(roomId: string): number {
  let h = 2166136261;
  for (let i = 0; i < roomId.length; i += 1)
    h = Math.imul(h ^ roomId.charCodeAt(i), 16777619) >>> 0;
  return Math.round(((h % 1000) * 137.508) % 360);
}
