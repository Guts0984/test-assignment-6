import { makeListRoomsHandler } from '@/server/modules/rooms/http';
import { ctxOf, deps, reply, req, world, type Who } from '@/server/tools/testing/harness';
import {
  makeCreateEventHandler,
  makeDeleteEventHandler,
  makeGetEventHandler,
  makeListEventsHandler,
  makeUpdateEventHandler,
} from '../http';

/** Thin client over the events route handlers, as the tests of this module use it. */
export const h = {
  list: makeListEventsHandler(deps()),
  rooms: makeListRoomsHandler(deps()),
  create: makeCreateEventHandler(deps()),
  get: makeGetEventHandler(deps()),
  update: makeUpdateEventHandler(deps()),
  del: makeDeleteEventHandler(deps()),
};

export const post = (who: Who, body: unknown) =>
  h.create(req('POST', '/api/events', who, body)).then(reply);
export const patch = (who: Who, id: string, body: unknown) =>
  h.update(req('PATCH', `/api/events/${id}`, who, body), ctxOf(id)).then(reply);
export const del = (who: Who, id: string, query: string) =>
  h.del(req('DELETE', `/api/events/${id}?${query}`, who), ctxOf(id)).then(reply);
export const getOne = (who: Who, id: string) =>
  h.get(req('GET', `/api/events/${id}`, who), ctxOf(id)).then(reply);
export const list = (from: string, to: string, extra = '', who: Who = 'ana') =>
  h.list(req('GET', `/api/events?from=${from}&to=${to}${extra}`, who)).then(reply);

export type Occ = {
  eventId: string;
  start: string;
  end: string;
  title: string;
  roomId: string;
  recurring: boolean;
  version: number;
  seriesId: string | null;
  creator: { name: string };
};
export const occurrences = async (from: string, to: string, extra = ''): Promise<Occ[]> =>
  (await list(from, to, extra)).body.occurrences;
export const starts = (occ: { start: string }[]) => occ.map((o) => o.start);

/** 1h meeting in room A on 2026-12-01 10:00Z unless overridden. */
export const meeting = (over: Record<string, unknown> = {}) => ({
  roomId: world.roomA,
  title: 'Meeting',
  startAt: '2026-12-01T10:00:00Z',
  endAt: '2026-12-01T11:00:00Z',
  ...over,
});

/** Monday 09:00 Kyiv weekly series, 10 occurrences: Mar 2..Mar 23 at 07:00Z, Mar 30..May 4 at 06:00Z. */
export const weekly = (over: Record<string, unknown> = {}) =>
  meeting({
    title: 'Weekly',
    tzid: 'Europe/Kyiv',
    startAt: '2026-03-02T07:00:00Z',
    endAt: '2026-03-02T08:00:00Z',
    rrule: 'FREQ=WEEKLY;BYDAY=MO;COUNT=10',
    ...over,
  });
export const WEEKLY_STARTS = [
  '2026-03-02T07:00:00Z',
  '2026-03-09T07:00:00Z',
  '2026-03-16T07:00:00Z',
  '2026-03-23T07:00:00Z',
  '2026-03-30T06:00:00Z',
  '2026-04-06T06:00:00Z',
  '2026-04-13T06:00:00Z',
  '2026-04-20T06:00:00Z',
  '2026-04-27T06:00:00Z',
  '2026-05-04T06:00:00Z',
];
export const ALL_2026 = ['2026-03-01T00:00:00Z', '2026-05-30T00:00:00Z'] as const;
