// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { EventDto } from '@/shared/contracts';
import { parseInstant } from '@/shared/zoned';
import { makeEvent } from '@/shared/calendar/test-utils';
import {
  addOccurrence,
  markError,
  mergeChange,
  patchOccurrence,
  removeOccurrences,
  settle,
  type Period,
} from './cache';

const at = (iso: string) => parseInstant(iso)!;
const WEEK: Period = {
  from: at('2026-11-09T00:00:00Z'),
  to: at('2026-11-16T00:00:00Z'),
  events: [],
};
const name = (id: string) => (id === 'u2' ? 'Bob' : 'Ana');

const dto = (over: Partial<EventDto> = {}): EventDto => ({
  id: 'e1',
  roomId: 'r1',
  title: 'Standup',
  description: '',
  startAt: '2026-11-10T09:00:00Z',
  endAt: '2026-11-10T10:00:00Z',
  allDay: false,
  tzid: 'UTC',
  rrule: null,
  exdates: [],
  seriesId: null,
  originalStart: null,
  version: 1,
  creatorId: 'u1',
  attendeeIds: [],
  ...over,
});
const ev = (id: string, start: string, end: string, version = 1) =>
  makeEvent(start, end, { eventId: id, version });
const withEvents = (...events: ReturnType<typeof ev>[]): Period => ({ ...WEEK, events });

describe('mergeChange: single events', () => {
  it('adds a new event that falls in the period, with the creator name resolved', () => {
    const { period, needsRefetch } = mergeChange(
      WEEK,
      { changed: [dto({ creatorId: 'u2' })], deletedEventIds: [] },
      name,
    );
    expect(period.events).toHaveLength(1);
    expect(period.events[0]).toMatchObject({
      eventId: 'e1',
      creatorName: 'Bob',
      version: 1,
      title: 'Standup',
    });
    expect(needsRefetch).toBe(false);
  });

  it('ignores an event outside the period', () => {
    const { period } = mergeChange(
      WEEK,
      {
        changed: [dto({ startAt: '2026-12-01T09:00:00Z', endAt: '2026-12-01T10:00:00Z' })],
        deletedEventIds: [],
      },
      name,
    );
    expect(period.events).toEqual([]);
  });

  it('an event that overlaps only the edge still counts (starts before, ends inside)', () => {
    const { period } = mergeChange(
      WEEK,
      {
        changed: [dto({ startAt: '2026-11-08T23:00:00Z', endAt: '2026-11-09T01:00:00Z' })],
        deletedEventIds: [],
      },
      name,
    );
    expect(period.events).toHaveLength(1);
    const touching = mergeChange(
      WEEK,
      {
        changed: [dto({ startAt: '2026-11-08T23:00:00Z', endAt: '2026-11-09T00:00:00Z' })],
        deletedEventIds: [],
      },
      name,
    );
    expect(touching.period.events).toEqual([]); // ends exactly at the start of the period: not inside
  });

  it('moves an event: the old time disappears, the new one appears, in order', () => {
    const before = withEvents(
      ev('e1', '2026-11-10T09:00:00Z', '2026-11-10T10:00:00Z'),
      ev('e2', '2026-11-11T09:00:00Z', '2026-11-11T10:00:00Z'),
    );
    const { period } = mergeChange(
      before,
      {
        changed: [
          dto({ version: 2, startAt: '2026-11-12T09:00:00Z', endAt: '2026-11-12T10:00:00Z' }),
        ],
        deletedEventIds: [],
      },
      name,
    );
    expect(period.events.map((e) => [e.eventId, e.version])).toEqual([
      ['e2', 1],
      ['e1', 2],
    ]);
  });

  it('moving an event OUT of the period removes it', () => {
    const before = withEvents(ev('e1', '2026-11-10T09:00:00Z', '2026-11-10T10:00:00Z'));
    const { period } = mergeChange(
      before,
      {
        changed: [
          dto({ version: 2, startAt: '2026-12-12T09:00:00Z', endAt: '2026-12-12T10:00:00Z' }),
        ],
        deletedEventIds: [],
      },
      name,
    );
    expect(period.events).toEqual([]);
  });

  it('deletes by id', () => {
    const before = withEvents(
      ev('e1', '2026-11-10T09:00:00Z', '2026-11-10T10:00:00Z'),
      ev('e2', '2026-11-11T09:00:00Z', '2026-11-11T10:00:00Z'),
    );
    expect(
      mergeChange(before, { changed: [], deletedEventIds: ['e1'] }, name).period.events.map(
        (e) => e.eventId,
      ),
    ).toEqual(['e2']);
  });

  it('our own echo (same version) changes nothing and returns the SAME object (no re-render, no flicker)', () => {
    const before = withEvents(ev('e1', '2026-11-10T09:00:00Z', '2026-11-10T10:00:00Z', 2));
    const { period, needsRefetch } = mergeChange(
      before,
      { changed: [dto({ version: 2 })], deletedEventIds: [] },
      name,
    );
    expect(period).toBe(before);
    expect(needsRefetch).toBe(false);
  });

  it('an OLDER version arriving late (out-of-order delivery) never overwrites newer state', () => {
    const before = withEvents(ev('e1', '2026-11-10T09:00:00Z', '2026-11-10T10:00:00Z', 5));
    const { period } = mergeChange(
      before,
      { changed: [dto({ version: 3, title: 'old title' })], deletedEventIds: [] },
      name,
    );
    expect(period).toBe(before);
    expect(period.events[0]?.title).toBe('Meeting');
  });

  it('a delete followed by a stale update of the same event does not resurrect it', () => {
    const after = mergeChange(
      withEvents(ev('e1', '2026-11-10T09:00:00Z', '2026-11-10T10:00:00Z', 2)),
      { changed: [], deletedEventIds: ['e1'] },
      name,
    ).period;
    // A late "version 2" echo of the same event: it is not in the cache any more, so it looks new.
    // The caller (sync layer) is responsible for remembering deletions; the cache alone cannot know.
    expect(
      mergeChange(after, { changed: [dto({ version: 2 })], deletedEventIds: [] }, name).period
        .events,
    ).toHaveLength(1);
  });
});

describe('mergeChange: series', () => {
  it('a changed series cannot be expanded in the browser: the period is flagged for refetch', () => {
    const before = withEvents(ev('s1', '2026-11-10T09:00:00Z', '2026-11-10T10:00:00Z'));
    const { period, needsRefetch } = mergeChange(
      before,
      { changed: [dto({ id: 's1', rrule: 'FREQ=WEEKLY', version: 2 })], deletedEventIds: [] },
      name,
    );
    expect(needsRefetch).toBe(true);
    expect(period.events).toEqual([]); // stale occurrences of the old series are dropped until the refetch lands
  });

  it('a series that starts after the period cannot affect it: no refetch', () => {
    const { needsRefetch } = mergeChange(
      WEEK,
      {
        changed: [
          dto({
            rrule: 'FREQ=DAILY',
            startAt: '2027-01-01T09:00:00Z',
            endAt: '2027-01-01T10:00:00Z',
          }),
        ],
        deletedEventIds: [],
      },
      name,
    );
    expect(needsRefetch).toBe(false);
  });

  it('deleting a series removes all its occurrences at once, without a refetch', () => {
    const before = withEvents(
      ev('s1', '2026-11-10T09:00:00Z', '2026-11-10T10:00:00Z'),
      ev('s1', '2026-11-11T09:00:00Z', '2026-11-11T10:00:00Z'),
      ev('e2', '2026-11-12T09:00:00Z', '2026-11-12T10:00:00Z'),
    );
    const { period, needsRefetch } = mergeChange(
      before,
      { changed: [], deletedEventIds: ['s1'] },
      name,
    );
    expect(period.events.map((e) => e.eventId)).toEqual(['e2']);
    expect(needsRefetch).toBe(false);
  });

  it('an "only this" edit: master (version bumped, still recurring) + detached single; the detached one shows immediately', () => {
    const before = withEvents(
      ev('s1', '2026-11-10T09:00:00Z', '2026-11-10T10:00:00Z'),
      ev('s1', '2026-11-17T09:00:00Z', '2026-11-17T10:00:00Z'),
    );
    const { period, needsRefetch } = mergeChange(
      before,
      {
        changed: [
          dto({ id: 's1', rrule: 'FREQ=WEEKLY', version: 2 }),
          dto({
            id: 'x1',
            seriesId: 's1',
            originalStart: '2026-11-10T09:00:00Z',
            startAt: '2026-11-10T14:00:00Z',
            endAt: '2026-11-10T15:00:00Z',
          }),
        ],
        deletedEventIds: [],
      },
      name,
    );
    expect(needsRefetch).toBe(true); // the rest of the series is re-expanded by the server
    expect(period.events.map((e) => e.eventId)).toContain('x1');
  });
});

describe('optimistic helpers', () => {
  const base = withEvents(
    ev('e1', '2026-11-10T09:00:00Z', '2026-11-10T10:00:00Z'),
    ev('e2', '2026-11-11T09:00:00Z', '2026-11-11T10:00:00Z'),
  );

  it('patchOccurrence moves one occurrence, marks it syncing, re-sorts, leaves others untouched', () => {
    const key = base.events[0]!.key;
    const next = patchOccurrence(base, key, {
      start: at('2026-11-13T09:00:00Z'),
      end: at('2026-11-13T10:00:00Z'),
    });
    expect(next.events.map((e) => e.eventId)).toEqual(['e2', 'e1']);
    expect(next.events[1]?.sync).toBe('syncing');
    expect(next.events[0]).toBe(base.events[1]); // untouched object identity: memoized rows do not re-render
  });

  it('patching an occurrence that is not in this period returns the same period object', () => {
    expect(patchOccurrence(base, 'nope@x', { title: 'x' })).toBe(base);
  });

  it('removeOccurrences by key removes one occurrence; by event id removes the series; "from" keeps earlier ones', () => {
    const series = withEvents(
      ev('s', '2026-11-10T09:00:00Z', '2026-11-10T10:00:00Z'),
      ev('s', '2026-11-11T09:00:00Z', '2026-11-11T10:00:00Z'),
      ev('s', '2026-11-12T09:00:00Z', '2026-11-12T10:00:00Z'),
    );
    expect(removeOccurrences(series, { key: series.events[1]!.key }).events).toHaveLength(2);
    expect(removeOccurrences(series, { eventId: 's' }).events).toEqual([]);
    expect(
      removeOccurrences(series, { eventId: 's', fromStart: at('2026-11-11T09:00:00Z') }).events,
    ).toHaveLength(1);
    expect(removeOccurrences(series, { eventId: 'other' })).toBe(series);
  });

  it('addOccurrence shows a new event as syncing only if it is inside the period', () => {
    expect(
      addOccurrence(base, ev('n', '2026-11-12T09:00:00Z', '2026-11-12T10:00:00Z')).events.find(
        (e) => e.eventId === 'n',
      )?.sync,
    ).toBe('syncing');
    expect(addOccurrence(base, ev('n', '2027-01-01T09:00:00Z', '2027-01-01T10:00:00Z'))).toBe(base);
  });

  it('settle clears the syncing mark; markError sets the error mark; both leave other events alone', () => {
    const syncing = patchOccurrence(base, base.events[0]!.key, { title: 'x' });
    expect(settle(syncing, 'e1').events.find((e) => e.eventId === 'e1')?.sync).toBeUndefined();
    expect(markError(syncing, 'e1').events.find((e) => e.eventId === 'e1')?.sync).toBe('error');
    expect(settle(base, 'e1')).toBe(base);
  });
});
