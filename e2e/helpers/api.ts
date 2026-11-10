import {
  request as playwrightRequest,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type TestInfo,
} from '@playwright/test';

export type Who = 'ana' | 'bob' | 'kenji';
export const EMAILS: Record<Who, string> = {
  ana: 'ana@example.com',
  bob: 'bob@example.com',
  kenji: 'kenji@example.com',
};
export const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'demo1234';
export const baseURL = () => process.env.BASE_URL ?? 'http://localhost:3000';

export type Room = { id: string; name: string; floor: number; capacity: number };
export type Created = { id: string; version: number };

/** An API client signed in as `who` (its cookie jar is the session). */
export async function apiAs(who: Who): Promise<APIRequestContext> {
  const api = await playwrightRequest.newContext({ baseURL: baseURL() });
  const res = await api.post('/api/auth/login', {
    data: { email: EMAILS[who], password: PASSWORD },
  });
  if (!res.ok()) throw new Error(`login as ${who} failed: ${res.status()}`);
  return api;
}

/** A browser context that is already signed in as `who`. */
export async function contextAs(
  browser: Browser,
  who: Who,
  options: Parameters<Browser['newContext']>[0] = {},
): Promise<BrowserContext> {
  const api = await apiAs(who);
  const storageState = await api.storageState();
  await api.dispose();
  return browser.newContext({ storageState, baseURL: baseURL(), ...options });
}

export async function getRooms(api: APIRequestContext): Promise<Room[]> {
  const res = await api.get('/api/rooms');
  return (await res.json()).rooms as Room[];
}

export type NewEvent = {
  roomId: string;
  title: string;
  startAt: string;
  endAt: string;
  allDay?: boolean;
  tzid?: string;
  rrule?: string | null;
  attendeeIds?: string[];
};

/** Tracks everything a test created so `cleanup()` can remove it, whatever the test did to it. */
export function createTracker(api: APIRequestContext) {
  const ids = new Set<string>();
  return {
    async create(body: NewEvent): Promise<Created> {
      const res = await api.post('/api/events', { data: body });
      if (res.status() !== 201)
        throw new Error(`create "${body.title}" failed: ${res.status()} ${await res.text()}`);
      const event = (await res.json()).events[0] as Created;
      ids.add(event.id);
      return event;
    },
    track: (id: string) => void ids.add(id),
    /** Deletes every tracked event (and, through cascade, series exceptions). Errors for already-gone events are fine. */
    async cleanup(): Promise<void> {
      for (const id of ids) {
        const current = await api.get(`/api/events/${id}`);
        if (!current.ok()) continue;
        const { version } = (await current.json()).event as { version: number };
        await api.delete(`/api/events/${id}?version=${version}&scope=all`);
      }
      ids.clear();
    },
  };
}

/** Anything left over from a crashed earlier run in this test's week is removed first. */
export async function sweepWeek(api: APIRequestContext, from: string, to: string): Promise<void> {
  const res = await api.get(
    `/api/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
  );
  if (!res.ok()) return;
  const { occurrences } = (await res.json()) as {
    occurrences: { eventId: string; version: number; title: string }[];
  };
  const mine = new Set<string>();
  for (const o of occurrences) {
    if (!o.title.startsWith('E2E') || mine.has(o.eventId)) continue;
    mine.add(o.eventId);
    await api.delete(`/api/events/${o.eventId}?version=${o.version}&scope=all`);
  }
}

/**
 * The test's own week: a Monday a year or more from now (clear of the seed data and inside the API's
 * ±5 years window), derived from the test title so it is the same on every run.
 */
export function weekOf(testInfo: TestInfo): {
  monday: string;
  wideTo: string;
  from: string;
  to: string;
  day: (offset: number) => string;
} {
  let h = 5381;
  for (const ch of testInfo.titlePath.join('|')) h = ((h << 5) + h + ch.charCodeAt(0)) >>> 0;
  const weeks = h % 150; // spread over ~3 years
  const base = Date.now() + 400 * 86_400_000;
  const monday =
    base - ((new Date(base).getUTCDay() + 6) % 7) * 86_400_000 + weeks * 7 * 86_400_000;
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return {
    wideTo: `${iso(monday + 70 * 86_400_000)}T00:00:00Z`,
    monday: iso(monday),
    from: `${iso(monday - 86_400_000)}T00:00:00Z`,
    to: `${iso(monday + 8 * 86_400_000)}T00:00:00Z`,
    day: (n) => iso(monday + n * 86_400_000),
  };
}

/** `2031-03-04` + Kyiv wall clock `10:30` as an instant. Kyiv is UTC+2 in winter, UTC+3 in summer. */
export function kyivInstant(date: string, time: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const summer = isKyivSummer(y, m, d);
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  const ms = Date.UTC(y, m - 1, d, hh - (summer ? 3 : 2), mm);
  return new Date(ms).toISOString().replace('.000Z', 'Z');
}
const lastSunday = (y: number, m: number) => {
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return last - new Date(Date.UTC(y, m - 1, last)).getUTCDay();
};
/** EU rules: summer time runs from the last Sunday of March to the last Sunday of October (at 01:00 UTC; day-level is enough for tests). */
const isKyivSummer = (y: number, m: number, d: number) =>
  (m > 3 && m < 10) || (m === 3 && d >= lastSunday(y, 3)) || (m === 10 && d < lastSunday(y, 10));

const nthSunday = (y: number, month: number, n: number) => {
  const first = new Date(Date.UTC(y, month - 1, 1)).getUTCDay();
  return 1 + ((7 - first) % 7) + (n - 1) * 7;
};
/** US rules: summer time from the second Sunday of March to the first Sunday of November (day-level is enough here). */
const isNySummer = (y: number, m: number, d: number) =>
  (m > 3 && m < 11) ||
  (m === 3 && d >= nthSunday(y, 3, 2)) ||
  (m === 11 && d < nthSunday(y, 11, 1));

/** A New York wall-clock time as an instant (profile zone of Bob). */
export function nyInstant(date: string, time: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1, d, hh + (isNySummer(y, m, d) ? 4 : 5), mm))
    .toISOString()
    .replace('.000Z', 'Z');
}
