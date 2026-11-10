import { expect, test } from '@playwright/test';
import {
  apiAs,
  contextAs,
  createTracker,
  getRooms,
  kyivInstant,
  sweepWeek,
  weekOf,
  type Room,
} from './helpers/api';
import { boxOf, dragBy, eventBlock, openCalendar, PX_PER_HOUR } from './helpers/ui';

test.describe('recurring events', () => {
  let rooms: Room[];
  let tracker: ReturnType<typeof createTracker>;
  let week: ReturnType<typeof weekOf>;

  test.beforeEach(async () => {
    week = weekOf(test.info());
    const ana = await apiAs('ana');
    rooms = await getRooms(ana);
    await sweepWeek(ana, '2028-12-30T00:00:00Z', '2029-05-01T00:00:00Z');
    await sweepWeek(ana, week.from, week.wideTo);
    tracker = createTracker(ana);
  });
  test.afterEach(async () => {
    await tracker.cleanup();
    const ana = await apiAs('ana');
    await sweepWeek(ana, '2028-12-30T00:00:00Z', '2029-05-01T00:00:00Z');
    await sweepWeek(ana, week.from, week.wideTo);
  });

  const listOccurrences = async (from: string, to: string, title?: string) => {
    const ana = await apiAs('ana');
    const res = await (await ana.get(`/api/events?from=${from}&to=${to}`)).json();
    const all = res.occurrences as { eventId: string; title: string; start: string; end: string }[];
    return title ? all.filter((o) => o.title === title) : all;
  };

  test('"every Monday at 09:00 Kyiv" is 09:00 Kyiv on weeks before and after the DST change (#3)', async ({
    browser,
  }) => {
    // Kyiv switches to summer time on Sunday 2029-03-25.
    await tracker.create({
      roomId: rooms[0]!.id,
      title: 'E2E Monday planning',
      tzid: 'Europe/Kyiv',
      startAt: '2029-03-12T07:00:00Z',
      endAt: '2029-03-12T08:00:00Z',
      rrule: 'FREQ=WEEKLY;BYDAY=MO;COUNT=8',
    });
    const ctx = await contextAs(browser, 'ana');
    const page = await ctx.newPage();
    for (const [monday, utcStart] of [
      ['2029-03-19', '2029-03-19T07:00:00Z'],
      ['2029-04-02', '2029-04-02T06:00:00Z'],
    ] as const) {
      await openCalendar(page, 'week', monday);
      const block = eventBlock(page, 'E2E Monday planning');
      await expect(block).toContainText('09:00 – 10:00'); // the same wall clock on both sides of the change
      expect((await listOccurrences(`${monday}T00:00:00Z`, `${monday}T23:00:00Z`))[0]?.start).toBe(
        utcStart,
      ); // ...but one hour apart in UTC
    }
    await ctx.close();
  });

  test('"only this": one occurrence moves, the rest of the series stays (#9 / series)', async ({
    browser,
  }) => {
    await tracker.create({
      roomId: rooms[1]!.id,
      title: 'E2E weekly sync',
      tzid: 'Europe/Kyiv',
      startAt: kyivInstant(week.day(1), '10:00'),
      endAt: kyivInstant(week.day(1), '11:00'),
      rrule: 'FREQ=WEEKLY;BYDAY=TU;COUNT=5',
    });
    const ctx = await contextAs(browser, 'ana');
    const page = await ctx.newPage();
    await openCalendar(page, 'week', week.day(8)); // the 2nd occurrence
    const box = await boxOf(eventBlock(page, 'E2E weekly sync'));
    await dragBy(page, { x: box.x + 20, y: box.y + 8 }, 0, 3 * PX_PER_HOUR); // 3 hours later
    await page.getByTestId('scope-this').click();
    await expect(page.getByTestId('sync-indicator')).toHaveAttribute('data-status', 'saved');

    await expect
      .poll(async () =>
        (await listOccurrences(week.from, `${week.day(35)}T00:00:00Z`, 'E2E weekly sync')).map(
          (o) => o.start.slice(11, 16),
        ),
      )
      .toEqual(['08:00', '11:00', '08:00', '08:00', '08:00']); // 10:00 Kyiv = 08:00Z, the second one moved to 13:00 Kyiv
    await ctx.close();
  });

  test('"this and following" in the middle of a series: earlier occurrences are untouched (#12)', async ({
    browser,
  }) => {
    const series = await tracker.create({
      roomId: rooms[2]!.id,
      title: 'E2E standup series',
      tzid: 'Europe/Kyiv',
      startAt: kyivInstant(week.day(2), '09:00'),
      endAt: kyivInstant(week.day(2), '10:00'),
      rrule: 'FREQ=WEEKLY;BYDAY=WE;COUNT=6',
    });
    const to = `${week.day(50)}T00:00:00Z`;
    const before = await listOccurrences(week.from, to, 'E2E standup series');
    expect(before).toHaveLength(6);

    const ctx = await contextAs(browser, 'ana');
    const page = await ctx.newPage();
    await openCalendar(page, 'week', week.day(23)); // the 4th occurrence (day 2 + 21)
    const box = await boxOf(eventBlock(page, 'E2E standup series'));
    await dragBy(page, { x: box.x + 20, y: box.y + 8 }, 0, 2 * PX_PER_HOUR); // two hours later
    await page.getByTestId('scope-following').click();
    await expect(page.getByTestId('sync-indicator')).toHaveAttribute('data-status', 'saved');

    await expect
      .poll(async () => (await listOccurrences(week.from, to, 'E2E standup series')).length)
      .toBe(6); // still six in total
    const after = await listOccurrences(week.from, to, 'E2E standup series');
    // The past is untouched (same events, times and titles). Only the series' version moved on.
    const essence = (list: typeof after) =>
      list.map(({ eventId, title, start, end }) => ({
        eventId,
        title,
        start,
        end,
      }));
    expect(essence(after.slice(0, 3))).toEqual(essence(before.slice(0, 3)));
    // 09:00 + 2 hours = 11:00 on the Kyiv wall clock, whatever the season (the rule keeps wall-clock time).
    const kyivClock = (iso: string) =>
      new Date(iso).toLocaleTimeString('en-GB', {
        timeZone: 'Europe/Kyiv',
        hour: '2-digit',
        minute: '2-digit',
      });
    expect(after.slice(3).map((o) => kyivClock(o.start))).toEqual(['11:00', '11:00', '11:00']);
    expect(after.slice(0, 3).map((o) => kyivClock(o.start))).toEqual(['09:00', '09:00', '09:00']);
    expect(after[0]?.eventId).toBe(series.id);
    expect(after[3]?.eventId).not.toBe(series.id); // the rest is a new series
    const newId = after[3]!.eventId;
    tracker.track(newId);
    await ctx.close();
  });

  test('deleting with scope "this" removes one occurrence only', async ({ browser }) => {
    await tracker.create({
      roomId: rooms[3]!.id,
      title: 'E2E daily',
      tzid: 'Europe/Kyiv',
      startAt: kyivInstant(week.day(0), '14:00'),
      endAt: kyivInstant(week.day(0), '15:00'),
      rrule: 'FREQ=DAILY;COUNT=4',
    });
    const ctx = await contextAs(browser, 'ana');
    const page = await ctx.newPage();
    await openCalendar(page, 'week', week.day(0));
    const target = page
      .locator('[data-column-id]')
      .nth(1)
      .locator('.event-block', { hasText: 'E2E daily' });
    await boxOf(target);
    await target.click();
    await page.keyboard.press('Delete');
    await page.getByTestId('scope-this').click();
    await expect(page.getByTestId('sync-indicator')).toHaveAttribute('data-status', 'saved');
    await expect
      .poll(async () => (await listOccurrences(week.from, to4(week), 'E2E daily')).length)
      .toBe(3);
    await ctx.close();
  });
});

const to4 = (w: ReturnType<typeof weekOf>) => `${w.day(6)}T23:00:00Z`;
