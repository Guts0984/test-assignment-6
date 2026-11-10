import type { QueryClient } from '@tanstack/react-query';
import type { CalEvent } from '@/shared/calendar';
import type { Period } from './cache';
import { keys } from './queries';

/** Every cached period (week, month grid, list window) with its query key. */
export const allPeriods = (client: QueryClient): Array<[readonly unknown[], Period]> =>
  client
    .getQueriesData<Period>({ queryKey: keys.periods })
    .filter((entry): entry is [readonly unknown[], Period] => entry[1] !== undefined);

/** Applies `fn` to every cached period. Periods that come back unchanged are not touched (no re-render). */
export function updatePeriods(client: QueryClient, fn: (period: Period) => Period): void {
  for (const [key, period] of allPeriods(client)) {
    const next = fn(period);
    if (next !== period) client.setQueryData(key, next);
  }
}

export const findByKey = (client: QueryClient, key: string): CalEvent | undefined => {
  for (const [, period] of allPeriods(client)) {
    const hit = period.events.find((e) => e.key === key);
    if (hit) return hit;
  }
  return undefined;
};

export const occurrencesOfEvent = (client: QueryClient, eventId: string): CalEvent[] => {
  const seen = new Map<string, CalEvent>();
  for (const [, period] of allPeriods(client))
    for (const e of period.events) if (e.eventId === eventId) seen.set(e.key, e);
  return [...seen.values()];
};

/** The version of an event as currently displayed (highest across its cached occurrences), or 1. */
export const versionOf = (client: QueryClient, eventId: string): number =>
  Math.max(1, ...occurrencesOfEvent(client, eventId).map((e) => e.version));
