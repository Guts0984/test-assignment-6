import { describe, expect, it } from 'vitest';
import { count, created, ids, setupApiWorld } from '@/server/tools/testing/harness';
import {
  post,
  patch,
  getOne,
  occurrences,
  starts,
  meeting,
  weekly,
  WEEKLY_STARTS,
  ALL_2026,
} from './api';

setupApiWorld();

describe('recurring edits: only this / this and following / all (acceptance #12)', () => {
  it('"only this": detaches one occurrence, the rest of the series is untouched', async () => {
    const ev = created(await post('ana', weekly()));
    const r = await patch('bob', ev.id, {
      version: 1,
      scope: 'this',
      occurrenceStart: '2026-04-06T06:00:00Z',
      title: 'One-off',
      startAt: '2026-04-07T12:00:00Z',
      endAt: '2026-04-07T13:00:00Z',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const [master, one] = r.body.events;
    expect(master).toMatchObject({
      id: ev.id,
      version: 2,
      exdates: ['2026-04-06T06:00:00Z'],
      rrule: 'FREQ=WEEKLY;BYDAY=MO;COUNT=10',
    });
    expect(one).toMatchObject({
      seriesId: ev.id,
      originalStart: '2026-04-06T06:00:00Z',
      rrule: null,
      title: 'One-off',
      creatorId: ids.ana,
    });

    const occ = await occurrences(...ALL_2026);
    expect(starts(occ)).toEqual([
      ...WEEKLY_STARTS.slice(0, 5),
      '2026-04-07T12:00:00Z',
      ...WEEKLY_STARTS.slice(6),
    ]);
    expect(occ.filter((o) => o.title === 'Weekly')).toHaveLength(9);
  });

  it('"only this" without changing the time keeps the occurrence where it was (e.g. rename one meeting)', async () => {
    const ev = created(await post('ana', weekly()));
    await patch('ana', ev.id, {
      version: 1,
      scope: 'this',
      occurrenceStart: '2026-03-30T06:00:00Z',
      title: 'Special',
    });
    const occ = await occurrences(...ALL_2026);
    expect(starts(occ)).toEqual(WEEKLY_STARTS);
    expect(occ.find((o) => o.start === '2026-03-30T06:00:00Z')?.title).toBe('Special');
  });

  it('"only this" into a busy slot: 409 and the series is exactly as before (no exdate, same version)', async () => {
    created(
      await post(
        'bob',
        meeting({
          title: 'Blocker',
          startAt: '2026-04-07T12:00:00Z',
          endAt: '2026-04-07T13:00:00Z',
        }),
      ),
    );
    const ev = created(await post('ana', weekly()));
    const r = await patch('ana', ev.id, {
      version: 1,
      scope: 'this',
      occurrenceStart: '2026-04-06T06:00:00Z',
      startAt: '2026-04-07T12:30:00Z',
      endAt: '2026-04-07T13:30:00Z',
    });
    expect(r.status).toBe(409);
    expect(r.body.error.details.blockers[0].title).toBe('Blocker');
    expect((await getOne('ana', ev.id)).body.event).toMatchObject({ version: 1, exdates: [] });
    expect(starts(await occurrences(...ALL_2026)).filter((s) => s.startsWith('2026-04-0'))).toEqual(
      ['2026-04-06T06:00:00Z', '2026-04-07T12:00:00Z'],
    );
    expect(await count('events')).toBe(2);
  });

  it('"only this" needs a real occurrenceStart', async () => {
    const ev = created(await post('ana', weekly()));
    for (const occurrenceStart of [
      undefined,
      '2026-04-06T07:00:00Z',
      '2026-04-07T06:00:00Z',
      '2027-01-01T06:00:00Z',
    ]) {
      const r = await patch('ana', ev.id, {
        version: 1,
        scope: 'this',
        title: 'x',
        ...(occurrenceStart ? { occurrenceStart } : {}),
      });
      expect(r.status, String(occurrenceStart)).toBe(400);
    }
    expect((await getOne('ana', ev.id)).body.event.version).toBe(1);
  });

  it('"only this" cannot change the rule, and an already-removed occurrence cannot be edited again', async () => {
    const ev = created(await post('ana', weekly()));
    expect(
      (
        await patch('ana', ev.id, {
          version: 1,
          scope: 'this',
          occurrenceStart: '2026-04-06T06:00:00Z',
          rrule: 'FREQ=DAILY',
        })
      ).status,
    ).toBe(400);
    await patch('ana', ev.id, {
      version: 1,
      scope: 'this',
      occurrenceStart: '2026-04-06T06:00:00Z',
      title: 'once',
    });
    expect(
      (
        await patch('ana', ev.id, {
          version: 2,
          scope: 'this',
          occurrenceStart: '2026-04-06T06:00:00Z',
          title: 'twice',
        })
      ).status,
    ).toBe(400);
  });

  it('"this and following" in the middle: past occurrences are byte-for-byte unchanged, the future changes, the total stays 10', async () => {
    const ev = created(await post('ana', weekly()));
    const pastBefore = await occurrences('2026-03-01T00:00:00Z', '2026-03-30T00:00:00Z');

    // From Mar 30: new title, one hour later (10:00 Kyiv = 07:00Z in summer time).
    const r = await patch('ana', ev.id, {
      version: 1,
      scope: 'following',
      occurrenceStart: '2026-03-30T06:00:00Z',
      title: 'New era',
      startAt: '2026-03-30T07:00:00Z',
      endAt: '2026-03-30T08:00:00Z',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const [oldMaster, newMaster] = r.body.events;
    expect(oldMaster).toMatchObject({
      id: ev.id,
      version: 2,
      rrule: expect.stringContaining('UNTIL=20260330T085959Z'),
    });
    expect(oldMaster.rrule).not.toContain('COUNT');
    expect(newMaster).toMatchObject({
      title: 'New era',
      rrule: 'FREQ=WEEKLY;BYDAY=MO;COUNT=6',
      version: 1,
    });

    const pastAfter = await occurrences('2026-03-01T00:00:00Z', '2026-03-30T00:00:00Z');
    // Identical (times, titles, event ids) except the series `version`, which rightly moved on.
    const noVersion = (o: object) =>
      Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'version'));
    expect(pastAfter.map(noVersion)).toEqual(pastBefore.map(noVersion));
    expect(pastBefore.every((o) => o.version === 1)).toBe(true);
    expect(pastAfter.every((o) => o.version === 2)).toBe(true);

    const all = await occurrences(...ALL_2026);
    expect(all).toHaveLength(10);
    expect(all.slice(0, 4).every((o) => o.title === 'Weekly' && o.eventId === ev.id)).toBe(true);
    expect(all.slice(4).every((o) => o.title === 'New era' && o.eventId === newMaster.id)).toBe(
      true,
    );
    expect(starts(all.slice(4))).toEqual([
      '2026-03-30T07:00:00Z',
      '2026-04-06T07:00:00Z',
      '2026-04-13T07:00:00Z',
      '2026-04-20T07:00:00Z',
      '2026-04-27T07:00:00Z',
      '2026-05-04T07:00:00Z',
    ]);
  });

  it('"this and following" keeps an UNTIL rule as is for the new series', async () => {
    const until = 'FREQ=WEEKLY;BYDAY=MO;UNTIL=20260511T000000Z';
    const ev = created(await post('ana', weekly({ rrule: until })));
    const r = await patch('ana', ev.id, {
      version: 1,
      scope: 'following',
      occurrenceStart: '2026-04-13T06:00:00Z',
      title: 'Later',
    });
    expect(r.body.events[1].rrule).toBe(until);
    const all = await occurrences(...ALL_2026);
    expect(starts(all)).toEqual(WEEKLY_STARTS); // same 10 dates, only titles differ
    expect(all.map((o) => o.title)).toEqual([
      ...Array(6).fill('Weekly'),
      ...Array(4).fill('Later'),
    ]);
  });

  it('"this and following" carries over later "only this" removals and attendees', async () => {
    const ev = created(await post('ana', weekly({ attendeeIds: [ids.bob] })));
    await patch('ana', ev.id, {
      version: 1,
      scope: 'this',
      occurrenceStart: '2026-04-20T06:00:00Z',
      title: 'once',
    }); // v2
    const r = await patch('ana', ev.id, {
      version: 2,
      scope: 'following',
      occurrenceStart: '2026-04-06T06:00:00Z',
      title: 'Rest',
    }); // v3
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.events[1].attendeeIds).toEqual([ids.bob]);
    expect(r.body.events[1].exdates).toEqual(['2026-04-20T06:00:00Z']);
    const all = await occurrences(...ALL_2026);
    expect(all.filter((o) => o.title === 'Rest').map((o) => o.start)).toEqual([
      '2026-04-06T06:00:00Z',
      '2026-04-13T06:00:00Z',
      '2026-04-27T06:00:00Z',
      '2026-05-04T06:00:00Z',
    ]);
    expect(all.filter((o) => o.title === 'once')).toHaveLength(1);
  });

  it('"this and following" into a conflict rolls back BOTH the old and the new series', async () => {
    created(
      await post(
        'bob',
        meeting({
          title: 'Blocker',
          startAt: '2026-04-13T08:00:00Z',
          endAt: '2026-04-13T09:00:00Z',
        }),
      ),
    );
    const ev = created(await post('ana', weekly()));
    const r = await patch('ana', ev.id, {
      version: 1,
      scope: 'following',
      occurrenceStart: '2026-04-06T06:00:00Z',
      startAt: '2026-04-06T08:00:00Z',
      endAt: '2026-04-06T09:00:00Z',
    });
    expect(r.status).toBe(409);
    expect(r.body.error.details.blockers[0].title).toBe('Blocker');
    expect((await getOne('ana', ev.id)).body.event).toMatchObject({
      version: 1,
      rrule: 'FREQ=WEEKLY;BYDAY=MO;COUNT=10',
    });
    expect(starts(await occurrences(...ALL_2026))).toContain('2026-04-27T06:00:00Z');
    expect(await count('events')).toBe(2);
  });

  it('"this and following" on the FIRST occurrence is the same as editing the whole series (no new event)', async () => {
    const ev = created(await post('ana', weekly()));
    const r = await patch('ana', ev.id, {
      version: 1,
      scope: 'following',
      occurrenceStart: '2026-03-02T07:00:00Z',
      title: 'All renamed',
    });
    expect(r.status).toBe(200);
    expect(await count('events')).toBe(1);
    expect((await occurrences(...ALL_2026)).every((o) => o.title === 'All renamed')).toBe(true);
  });

  it('"all": changes the whole series in place; the new time keeps its wall clock across DST', async () => {
    const ev = created(await post('ana', weekly()));
    // 10:00 Kyiv = 08:00Z in winter. Moves every occurrence.
    const r = await patch('ana', ev.id, {
      version: 1,
      scope: 'all',
      startAt: '2026-03-02T08:00:00Z',
      endAt: '2026-03-02T09:30:00Z',
      title: 'Later start',
    });
    expect(r.status).toBe(200);
    const occ = await occurrences(...ALL_2026);
    expect(occ).toHaveLength(10);
    expect(occ.map((o) => o.start.slice(11, 16))).toEqual([
      '08:00',
      '08:00',
      '08:00',
      '08:00',
      '07:00',
      '07:00',
      '07:00',
      '07:00',
      '07:00',
      '07:00',
    ]);
    expect(occ.every((o) => o.title === 'Later start')).toBe(true);
  });

  it('"all" with a new time also drops earlier "only this" edits (they referred to the old times)', async () => {
    const ev = created(await post('ana', weekly()));
    const one = await patch('ana', ev.id, {
      version: 1,
      scope: 'this',
      occurrenceStart: '2026-04-06T06:00:00Z',
      title: 'once',
    });
    const exceptionId = one.body.events[1].id;
    const r = await patch('ana', ev.id, {
      version: 2,
      scope: 'all',
      startAt: '2026-03-02T08:00:00Z',
      endAt: '2026-03-02T09:00:00Z',
    });
    expect(r.body.deletedEventIds).toEqual([exceptionId]);
    expect(r.body.events[0].exdates).toEqual([]);
    const occ = await occurrences(...ALL_2026);
    expect(occ).toHaveLength(10);
    expect(occ.some((o) => o.title === 'once')).toBe(false);
  });

  it('"all" without a time change keeps "only this" edits', async () => {
    const ev = created(await post('ana', weekly()));
    await patch('ana', ev.id, {
      version: 1,
      scope: 'this',
      occurrenceStart: '2026-04-06T06:00:00Z',
      title: 'once',
    });
    await patch('ana', ev.id, { version: 2, scope: 'all', title: 'Renamed series' });
    const occ = await occurrences(...ALL_2026);
    expect(occ.filter((o) => o.title === 'once')).toHaveLength(1);
    expect(occ.filter((o) => o.title === 'Renamed series')).toHaveLength(9);
  });

  it('a series can be turned into a single event and back', async () => {
    const ev = created(await post('ana', weekly()));
    await patch('ana', ev.id, { version: 1, rrule: null });
    expect(await occurrences(...ALL_2026)).toHaveLength(1);
    await patch('ana', ev.id, { version: 2, rrule: 'FREQ=WEEKLY;BYDAY=MO;COUNT=3' });
    expect(starts(await occurrences(...ALL_2026))).toEqual(WEEKLY_STARTS.slice(0, 3));
  });
});
