import { Temporal } from '@js-temporal/polyfill';
import { describe, expect, it } from 'vitest';
import { extendOpenSeries } from '../service/extend-series';
import { count, created, world, NOW, setupApiWorld } from '@/server/tools/testing/harness';
import { post, list, occurrences, starts, meeting, weekly, WEEKLY_STARTS, ALL_2026 } from './api';

setupApiWorld();

describe('recurring events', () => {
  it('Monday 09:00 Kyiv stays 09:00 Kyiv before and after DST (acceptance #3)', async () => {
    created(await post('ana', weekly()));
    expect(starts(await occurrences(...ALL_2026))).toEqual(WEEKLY_STARTS);
  });

  it('a window cuts the series without changing it', async () => {
    created(await post('ana', weekly()));
    expect(starts(await occurrences('2026-03-23T00:00:00Z', '2026-04-07T00:00:00Z'))).toEqual(
      WEEKLY_STARTS.slice(3, 6),
    );
  });

  it('open-ended series: materialized a year ahead, extended on read, never duplicated', async () => {
    // Thursday 12:00 Kyiv (10:00Z in winter), forever.
    const ev = created(
      await post(
        'ana',
        meeting({
          title: 'All-hands',
          startAt: '2026-11-12T10:00:00Z',
          endAt: '2026-11-12T11:00:00Z',
          tzid: 'Europe/Kyiv',
          rrule: 'FREQ=WEEKLY;BYDAY=TH',
        }),
      ),
    );
    const [row] =
      await world.raw`select materialized_until::text as mu from events where id = ${ev.id}`;
    expect(Temporal.Instant.from((row!.mu as string).replace(' ', 'T')).toString()).toBe(
      '2027-11-10T12:00:00Z',
    );

    const summer = await occurrences('2027-07-01T00:00:00Z', '2027-07-15T00:00:00Z');
    expect(starts(summer)).toEqual(['2027-07-01T09:00:00Z', '2027-07-08T09:00:00Z']); // still 12:00 Kyiv (UTC+3)

    const far = await occurrences('2028-01-01T00:00:00Z', '2028-01-20T00:00:00Z');
    expect(starts(far)).toEqual(['2028-01-06T10:00:00Z', '2028-01-13T10:00:00Z']);
    const n1 = await count('event_occurrences');
    await occurrences('2028-01-01T00:00:00Z', '2028-01-20T00:00:00Z');
    expect(await count('event_occurrences')).toBe(n1); // second read adds nothing
    const [after] =
      await world.raw`select materialized_until > '2028-01-20T00:00:00Z'::timestamptz as ok from events where id = ${ev.id}`;
    expect(after?.ok).toBe(true);
  });

  it('extension skips an occurrence that someone booked in the meantime instead of failing', async () => {
    created(
      await post(
        'ana',
        meeting({
          title: 'All-hands',
          startAt: '2026-11-12T10:00:00Z',
          endAt: '2026-11-12T11:00:00Z',
          rrule: 'FREQ=WEEKLY;BYDAY=TH',
        }),
      ),
    );
    // Beyond the materialized horizon the room still looks free, so this is accepted:
    created(
      await post(
        'bob',
        meeting({
          title: 'Squatter',
          startAt: '2028-01-06T10:00:00Z',
          endAt: '2028-01-06T11:00:00Z',
        }),
      ),
    );
    const far = await list('2028-01-01T00:00:00Z', '2028-01-20T00:00:00Z');
    expect(far.status).toBe(200);
    expect(
      far.body.occurrences.map((o: { title: string; start: string }) => [o.title, o.start]),
    ).toEqual([
      ['Squatter', '2028-01-06T10:00:00Z'],
      ['All-hands', '2028-01-13T10:00:00Z'],
    ]);
  });

  it('extending an open-ended series never goes past the supported span, whatever is asked for', async () => {
    created(await post('ana', meeting({ rrule: 'FREQ=DAILY' })));
    const before = await count('event_occurrences');
    // What a request for the year 9000 used to do: write a row for every day until then.
    await extendOpenSeries(world.db, Temporal.Instant.from('9000-01-01T00:00:00Z'), NOW);
    const rows = await count('event_occurrences');
    // About 5.5 years of days (the limit plus the 6-month look-ahead), not 2.5 million.
    expect(rows).toBeGreaterThan(before);
    expect(rows).toBeLessThan(2200);
    const [row] = await world.raw`select max(upper(during))::text as last from event_occurrences`;
    expect(
      Temporal.Instant.compare(
        Temporal.Instant.from(String(row?.last)),
        NOW.add({ hours: 24 * 366 * 6 }),
      ),
    ).toBeLessThan(0);
  });
});
