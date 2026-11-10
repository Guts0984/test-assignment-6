import { expect, test, type Page } from '@playwright/test';
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

/** Recurring events made and edited through the UI: daily / weekly / monthly, ends by date or count, scope "all". */
test.describe('recurrence in the UI', () => {
  let rooms: Room[];
  let tracker: ReturnType<typeof createTracker>;
  let week: ReturnType<typeof weekOf>;
  const horizon = () => `${week.day(100)}T00:00:00Z`;

  test.beforeEach(async () => {
    week = weekOf(test.info());
    const ana = await apiAs('ana');
    await ana.patch('/api/me', { data: { timezone: 'Europe/Kyiv', locale: 'uk' } });
    rooms = await getRooms(ana);
    await sweepWeek(ana, week.from, horizon());
    tracker = createTracker(ana);
  });
  test.afterEach(async () => {
    await tracker.cleanup();
    await sweepWeek(await apiAs('ana'), week.from, horizon());
  });

  /** Draws 10:00–11:00 on Tuesday of the test week, names it, picks a room: the panel is left open. */
  async function startPanel(page: Page, title: string, room: Room) {
    await openCalendar(page, 'week', week.day(1));
    const box = await boxOf(page.locator('[data-column-id]').nth(1));
    await dragBy(
      page,
      { x: box.x + box.width / 2, y: box.y + 10 * PX_PER_HOUR + 2 },
      0,
      PX_PER_HOUR - 6,
    );
    await expect(page.getByTestId('event-panel')).toBeVisible();
    await page.getByTestId('field-title').fill(title);
    await page.getByTestId('field-room').selectOption(room.id);
  }

  async function save(page: Page) {
    await page.getByTestId('panel-save').click();
    await expect(page.getByTestId('sync-indicator')).toHaveAttribute('data-status', 'saved');
  }

  const occurrencesOf = async (title: string) => {
    const ana = await apiAs('ana');
    const res = await (await ana.get(`/api/events?from=${week.from}&to=${horizon()}`)).json();
    const list = (
      res.occurrences as { eventId: string; title: string; start: string; end: string }[]
    ).filter((o) => o.title === title);
    for (const o of list) tracker.track(o.eventId);
    return list;
  };

  test('daily, ends after 3 occurrences', async ({ browser }) => {
    const ctx = await contextAs(browser, 'ana');
    const page = await ctx.newPage();
    await startPanel(page, 'E2E daily x3', rooms[5]!);
    await page.getByTestId('field-repeat').selectOption('daily');
    await page.getByTestId('end-count').check();
    await page.getByTestId('end-count-value').fill('3');
    await save(page);
    const list = await occurrencesOf('E2E daily x3');
    expect(list.map((o) => o.start)).toEqual(
      [1, 2, 3].map((n) => kyivInstant(week.day(n), '10:00')),
    );
    await ctx.close();
  });

  test('weekly: the start day is locked on, other days can be added, ends on a date with nothing after it', async ({
    browser,
  }) => {
    const ctx = await contextAs(browser, 'ana');
    const page = await ctx.newPage();
    await startPanel(page, 'E2E weekly MoWe', rooms[6]!); // starts on a Tuesday
    await page.getByTestId('field-repeat').selectOption('weekly');
    // The first occurrence is on Tuesday, so Tuesday is always in the rule: shown on, and cannot be turned off.
    const tuesday = page.getByTestId('weekday-TU');
    await expect(tuesday).toBeChecked();
    await expect(tuesday).toBeDisabled();
    for (const code of ['MO', 'WE'])
      await page.getByTestId(`weekday-${code}`).locator('xpath=..').click();
    await page.getByTestId('end-until').check();
    await page.getByTestId('end-until-date').fill(week.day(15)); // up to and including the Tuesday of week 3
    await save(page);
    const list = await occurrencesOf('E2E weekly MoWe');
    // Tue (start), Wed, then Mon/Tue/Wed of week 2 and week 3 up to the end date: nothing after it.
    expect(list.map((o) => o.start.slice(0, 10))).toEqual(
      [1, 2, 7, 8, 9, 14, 15].map((n) => week.day(n)),
    );
    await ctx.close();
  });

  test('monthly, ends after 3: the same day of each month', async ({ browser }) => {
    const ctx = await contextAs(browser, 'ana');
    const page = await ctx.newPage();
    await startPanel(page, 'E2E monthly x3', rooms[7]!);
    await page.getByTestId('field-repeat').selectOption('monthly');
    await page.getByTestId('end-count').check();
    await page.getByTestId('end-count-value').fill('3');
    await save(page);
    const list = await occurrencesOf('E2E monthly x3');
    expect(list).toHaveLength(3);
    const dom = list.map((o) => Number(o.start.slice(8, 10)));
    // Same day of the month (or the last day when the month is shorter), and one month apart each time.
    const months = list.map((o) => Number(o.start.slice(5, 7)));
    expect(new Set(dom).size).toBeLessThanOrEqual(2);
    expect((months[1]! - months[0]! + 12) % 12).toBe(1);
    expect((months[2]! - months[1]! + 12) % 12).toBe(1);
    await ctx.close();
  });

  test('editing with scope "all" shifts every occurrence and keeps the wall clock across DST', async ({
    browser,
  }) => {
    // Weekly on Tuesdays across the Kyiv spring change of 2029-03-25.
    await tracker.create({
      roomId: rooms[8]!.id,
      title: 'E2E all-scope',
      tzid: 'Europe/Kyiv',
      startAt: '2029-03-13T08:00:00Z', // 10:00 Kyiv (UTC+2)
      endAt: '2029-03-13T09:00:00Z',
      rrule: 'FREQ=WEEKLY;BYDAY=TU;COUNT=4',
    });
    const ctx = await contextAs(browser, 'ana');
    const page = await ctx.newPage();
    await openCalendar(page, 'week', '2029-03-13');
    const box = await boxOf(eventBlock(page, 'E2E all-scope'));
    await dragBy(page, { x: box.x + 20, y: box.y + 8 }, 0, 2 * PX_PER_HOUR); // two hours later, same day
    await page.getByTestId('scope-all').click();
    await expect(page.getByTestId('sync-indicator')).toHaveAttribute('data-status', 'saved');
    const ana = await apiAs('ana');
    const res = await (
      await ana.get('/api/events?from=2029-03-01T00:00:00Z&to=2029-04-30T00:00:00Z')
    ).json();
    const list = (res.occurrences as { title: string; start: string }[]).filter(
      (o) => o.title === 'E2E all-scope',
    );
    // 12:00 Kyiv every week: 10:00Z before the change on 03-25, 09:00Z after it.
    expect(list.map((o) => o.start)).toEqual([
      '2029-03-13T10:00:00Z',
      '2029-03-20T10:00:00Z',
      '2029-03-27T09:00:00Z',
      '2029-04-03T09:00:00Z',
    ]);
    await ctx.close();
  });
});
