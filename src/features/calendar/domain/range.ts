import {
  addDays,
  addMonths,
  daysInMonth,
  startOfDay,
  startOfMonth,
  startOfWeek,
  diffDays,
  type Civil,
  type Weekday,
} from '@/shared/zoned';

export type View = 'day' | 'week' | 'month' | 'list';
export const VIEWS: readonly View[] = ['day', 'week', 'month', 'list'];

/** First day of the week per locale: Ukraine starts on Monday, the English (US) default on Sunday. */
export const WEEK_START: Record<string, Weekday> = { uk: 1, en: 7 };
export const weekStartOf = (locale: string): Weekday => WEEK_START[locale] ?? 1;

/** The list view loads (and infinite-scrolls) this many days at a time. */
export const LIST_WINDOW_DAYS = 14;

export type Range = {
  view: View;
  anchor: Civil;
  /** The visible days, in order. The month grid includes the days of neighbouring months. */
  days: Civil[];
  /** The instants the range covers in the viewer's zone: [from, to). */
  from: number;
  to: number;
};

const sequence = (first: Civil, count: number): Civil[] =>
  Array.from({ length: count }, (_, i) => addDays(first, i));

/** The days shown for `view` around `anchor`. The week (and month grid) start depends on the locale. */
export function daysOf(view: View, anchor: Civil, weekStart: Weekday): Civil[] {
  switch (view) {
    case 'day':
      return [anchor];
    case 'week':
      return sequence(startOfWeek(anchor, weekStart), 7);
    case 'list':
      return sequence(anchor, LIST_WINDOW_DAYS);
    case 'month': {
      const first = startOfWeek(startOfMonth(anchor), weekStart);
      const lastOfMonth = { y: anchor.y, m: anchor.m, d: daysInMonth(anchor.y, anchor.m) };
      const weeks = Math.floor(diffDays(first, startOfWeek(lastOfMonth, weekStart)) / 7) + 1;
      return sequence(first, weeks * 7);
    }
  }
}

export function rangeOf(view: View, anchor: Civil, weekStart: Weekday, tz: string): Range {
  const days = daysOf(view, anchor, weekStart);
  return {
    view,
    anchor,
    days,
    from: startOfDay(days[0] as Civil, tz),
    to: startOfDay(addDays(days[days.length - 1] as Civil, 1), tz),
  };
}

/** The anchor after pressing "previous" (-1) or "next" (+1). */
export function shiftAnchor(view: View, anchor: Civil, direction: -1 | 1): Civil {
  switch (view) {
    case 'day':
      return addDays(anchor, direction);
    case 'week':
      return addDays(anchor, 7 * direction);
    case 'month':
      return addMonths({ ...anchor, d: 1 }, direction);
    case 'list':
      return addDays(anchor, LIST_WINDOW_DAYS * direction);
  }
}

/** The ranges just before and after, to prefetch so paging feels instant. */
export const neighborRanges = (range: Range, weekStart: Weekday, tz: string): [Range, Range] => [
  rangeOf(range.view, shiftAnchor(range.view, range.anchor, -1), weekStart, tz),
  rangeOf(range.view, shiftAnchor(range.view, range.anchor, 1), weekStart, tz),
];
