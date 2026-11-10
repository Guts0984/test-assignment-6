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
import { openCalendar } from './helpers/ui';

test.describe('views: day with many rooms, list with infinite scroll', () => {
  let rooms: Room[];
  let tracker: ReturnType<typeof createTracker>;
  let week: ReturnType<typeof weekOf>;

  test.beforeEach(async () => {
    week = weekOf(test.info());
    const ana = await apiAs('ana');
    rooms = await getRooms(ana);
    await sweepWeek(ana, week.from, week.wideTo);
    tracker = createTracker(ana);
  });
  test.afterEach(async () => {
    await tracker.cleanup();
    await sweepWeek(await apiAs('ana'), week.from, week.wideTo);
  });

  test('day view with 50 rooms: columns scroll sideways while the time axis and headings stay pinned', async ({
    browser,
  }) => {
    await tracker.create({
      roomId: rooms[40]!.id,
      title: 'E2E far room',
      startAt: kyivInstant(week.day(1), '10:00'),
      endAt: kyivInstant(week.day(1), '11:00'),
    });
    const ctx = await contextAs(browser, 'ana', { viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    await openCalendar(
      page,
      'day',
      week.day(1),
      rooms.slice(0, 50).map((r) => r.id),
    );
    await expect(page.locator('[data-column-id]')).toHaveCount(50);

    const grid = page.getByTestId('time-grid');
    const axis = page.getByTestId('time-axis');
    const farBlock = page.locator('.event-block[data-key]', { hasText: 'E2E far room' });
    const axisBefore = await axis.boundingBox();
    const header = grid.locator('div.sticky.top-0').filter({ hasText: rooms[40]!.name }).first();

    // Room 41 is far to the right: not on screen until we scroll sideways.
    expect((await header.boundingBox())!.x).toBeGreaterThan(1280);
    await grid.evaluate((el) => {
      el.scrollLeft = 40 * 132; // 40 columns across
    });
    await expect(header).toBeInViewport();
    await expect(farBlock).toBeInViewport();
    // ...and meanwhile the hour labels did not move (time is pinned on the left).
    const axisAfter = await axis.boundingBox();
    expect(axisAfter!.x).toBe(axisBefore!.x);
    // The column headings stay at the top while the grid scrolls down.
    const headerTop = (await header.boundingBox())!.y;
    await grid.evaluate((el) => {
      el.scrollTop = 600;
    });
    expect(Math.abs((await header.boundingBox())!.y - headerTop)).toBeLessThan(1);
    await ctx.close();
  });

  test('list view loads the next days as you scroll, with no paging buttons', async ({
    browser,
  }) => {
    await tracker.create({
      roomId: rooms[0]!.id,
      title: 'E2E list near',
      startAt: kyivInstant(week.day(1), '10:00'),
      endAt: kyivInstant(week.day(1), '11:00'),
    });
    await tracker.create({
      roomId: rooms[1]!.id,
      title: 'E2E list far',
      startAt: kyivInstant(week.day(30), '10:00'),
      endAt: kyivInstant(week.day(30), '11:00'),
    });
    const ctx = await contextAs(browser, 'ana');
    const page = await ctx.newPage();
    const windows = new Set<string>();
    page.on('request', (r) => {
      const m = /\/api\/events\?from=([^&]+)/.exec(r.url());
      if (m) windows.add(decodeURIComponent(m[1]!));
    });
    await openCalendar(page, 'list', week.day(0));
    const list = page.getByTestId('list-view');
    await expect(list.getByText('E2E list near')).toBeVisible();
    // 30 days is beyond the first 14-day window: it appears only once later windows were requested.
    await expect(list.getByText('E2E list far')).toBeVisible({ timeout: 20_000 });
    expect(windows.size).toBeGreaterThanOrEqual(3);
    // Days come out in order: the near meeting is above the far one.
    const near = (await list.getByText('E2E list near').boundingBox())!;
    const far = (await list.getByText('E2E list far').boundingBox())!;
    expect(near.y).toBeLessThan(far.y);
    await ctx.close();
  });
});
