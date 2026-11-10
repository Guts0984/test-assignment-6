import { dayOf } from '../domain/segments';
import { VIEWS, type View } from '../domain/range';
import { formatCivil, parseCivil, type Civil } from '@/shared/zoned';

/** What the address bar says about the calendar: the view, the anchor date and the room filter. */
export type CalendarLocation = {
  view: View;
  date: Civil;
  /** Selected room ids; empty = all rooms. */
  rooms: string[];
};

export const DEFAULT_VIEW: View = 'week';
export const MAX_ROOMS = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Raw = Record<string, string | string[] | undefined> | URLSearchParams;
const read = (raw: Raw, key: string): string | undefined => {
  const v = raw instanceof URLSearchParams ? (raw.get(key) ?? undefined) : raw[key];
  return Array.isArray(v) ? v[0] : v;
};

/** Parses `?view=week&date=2026-11-10&rooms=id1,id2`. Anything invalid falls back to a safe default. */
export function parseLocation(raw: Raw, now: number, tz: string): CalendarLocation {
  const viewText = read(raw, 'view');
  const view = VIEWS.find((v) => v === viewText) ?? DEFAULT_VIEW;
  const date = parseCivil(read(raw, 'date') ?? '') ?? dayOf(now, tz);
  const rooms = [
    ...new Set(
      (read(raw, 'rooms') ?? '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter((s) => UUID.test(s)),
    ),
  ].slice(0, MAX_ROOMS);
  return { view, date, rooms };
}

/** The query string for a location: view and date always, rooms only when filtered. */
export function toSearch(location: CalendarLocation): string {
  const params = new URLSearchParams({ view: location.view, date: formatCivil(location.date) });
  if (location.rooms.length > 0) params.set('rooms', location.rooms.join(','));
  return params.toString();
}

export const sameLocation = (a: CalendarLocation, b: CalendarLocation): boolean =>
  a.view === b.view &&
  formatCivil(a.date) === formatCivil(b.date) &&
  a.rooms.join() === b.rooms.join();
