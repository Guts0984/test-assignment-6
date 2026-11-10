import { describe, expect, it } from 'vitest';
import { count, created, setupApiWorld } from '@/server/tools/testing/harness';
import {
  post,
  patch,
  del,
  getOne,
  occurrences,
  starts,
  meeting,
  weekly,
  WEEKLY_STARTS,
  ALL_2026,
} from './api';

setupApiWorld();

describe('DELETE', () => {
  it('deletes a single event and frees the slot', async () => {
    const ev = created(await post('ana', meeting()));
    const r = await del('bob', ev.id, 'version=1');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ events: [], deletedEventIds: [ev.id] });
    expect(await occurrences('2026-12-01T00:00:00Z', '2026-12-02T00:00:00Z')).toHaveLength(0);
    created(await post('bob', meeting())); // slot is free again
    expect((await getOne('ana', ev.id)).status).toBe(404);
  });

  it('a stale version cannot delete (409 with the current state)', async () => {
    const ev = created(await post('ana', meeting()));
    await patch('ana', ev.id, { version: 1, title: 'Changed meanwhile' });
    const r = await del('bob', ev.id, 'version=1');
    expect(r.status).toBe(409);
    expect(r.body.error.details.current.title).toBe('Changed meanwhile');
    expect((await getOne('ana', ev.id)).status).toBe(200);
  });

  it('"all" removes the series with its detached exceptions', async () => {
    const ev = created(await post('ana', weekly()));
    const one = await patch('ana', ev.id, {
      version: 1,
      scope: 'this',
      occurrenceStart: '2026-04-06T06:00:00Z',
      title: 'once',
    });
    const r = await del('ana', ev.id, 'version=2&scope=all');
    expect(r.body.deletedEventIds.sort()).toEqual([ev.id, one.body.events[1].id].sort());
    expect([await count('events'), await count('event_occurrences')]).toEqual([0, 0]);
  });

  it('"only this" removes one occurrence', async () => {
    const ev = created(await post('ana', weekly()));
    const r = await del('ana', ev.id, 'version=1&scope=this&occurrenceStart=2026-04-06T06:00:00Z');
    expect(r.status).toBe(200);
    expect(r.body.events[0]).toMatchObject({ version: 2, exdates: ['2026-04-06T06:00:00Z'] });
    expect(starts(await occurrences(...ALL_2026))).toEqual(
      WEEKLY_STARTS.filter((s) => s !== '2026-04-06T06:00:00Z'),
    );
  });

  it('"this and following" ends the series before the chosen occurrence, the past stays', async () => {
    const ev = created(await post('ana', weekly()));
    const r = await del(
      'ana',
      ev.id,
      'version=1&scope=following&occurrenceStart=2026-03-30T06:00:00Z',
    );
    expect(r.status).toBe(200);
    expect(starts(await occurrences(...ALL_2026))).toEqual(WEEKLY_STARTS.slice(0, 4));
    expect((await getOne('ana', ev.id)).body.event.rrule).toContain('UNTIL=20260330T085959Z');
  });

  it('"this and following" on the first occurrence deletes everything', async () => {
    const ev = created(await post('ana', weekly()));
    await del('ana', ev.id, 'version=1&scope=following&occurrenceStart=2026-03-02T07:00:00Z');
    expect(await count('events')).toBe(0);
  });

  it.each([
    ['no version', ''],
    ['bad version', 'version=abc'],
    ['bad scope', 'version=1&scope=everything'],
    ['scope this without occurrenceStart', 'version=1&scope=this'],
    [
      'occurrenceStart that is not an occurrence',
      'version=1&scope=this&occurrenceStart=2026-04-07T06:00:00Z',
    ],
  ])('rejects %s and deletes nothing', async (_n, qs) => {
    const ev = created(await post('ana', weekly()));
    const r = await del('ana', ev.id, qs);
    expect(r.status).toBe(400);
    expect(await occurrences(...ALL_2026)).toHaveLength(10);
  });

  it('a scope on a non-recurring event is a 400; unknown id is a 404', async () => {
    const ev = created(await post('ana', meeting()));
    expect(
      (await del('ana', ev.id, 'version=1&scope=this&occurrenceStart=2026-12-01T10:00:00Z')).status,
    ).toBe(400);
    expect((await del('ana', '00000000-0000-4000-8000-000000000000', 'version=1')).status).toBe(
      404,
    );
  });
});
