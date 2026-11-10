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
import { eventBlock, openCalendar } from './helpers/ui';

test.describe('overlapping events (acceptance #6)', () => {
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

  test('five meetings that overlap in time sit side by side without covering each other, and keep that layout after a reload', async ({
    browser,
  }) => {
    // Five different rooms (a room cannot host two meetings at once), all on the same day at overlapping times.
    // Every one of them is on screen at 11:00-11:15, so all five overlap each other.
    const starts = ['10:00', '10:15', '10:30', '10:45', '11:00'];
    const ends = ['12:00', '11:45', '11:30', '11:15', '12:00'];
    for (let i = 0; i < 5; i += 1) {
      await tracker.create({
        roomId: rooms[i]!.id,
        title: `E2E overlap ${i + 1}`,
        startAt: kyivInstant(week.day(2), starts[i]!),
        endAt: kyivInstant(week.day(2), ends[i]!),
      });
    }
    const ctx = await contextAs(browser, 'ana');
    const page = await ctx.newPage();
    await openCalendar(page, 'week', week.day(2));

    const boxes = async () => {
      const out = [];
      for (let i = 1; i <= 5; i += 1) {
        const block = eventBlock(page, `E2E overlap ${i}`);
        await block.scrollIntoViewIfNeeded();
        out.push((await block.boundingBox())!);
      }
      return out;
    };
    const before = await boxes();
    // They overlap in TIME, so no two rectangles may overlap on screen.
    for (let i = 0; i < 5; i += 1) {
      for (let j = i + 1; j < 5; j += 1) {
        const [a, b] = [before[i]!, before[j]!];
        const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
        expect(
          overlapX,
          `overlap ${i + 1} and ${j + 1} share horizontal space`,
        ).toBeLessThanOrEqual(0.5);
      }
    }
    expect(new Set(before.map((b) => Math.round(b.width))).size).toBeLessThanOrEqual(2); // equal widths (±rounding)

    await page.reload();
    await expect(eventBlock(page, 'E2E overlap 1')).toBeVisible();
    const after = await boxes();
    after.forEach((box, i) => {
      expect(Math.abs(box.x - before[i]!.x), `x of ${i + 1}`).toBeLessThan(1);
      expect(Math.abs(box.width - before[i]!.width), `width of ${i + 1}`).toBeLessThan(1);
      expect(Math.abs(box.y - before[i]!.y), `y of ${i + 1}`).toBeLessThan(1);
    });
    await ctx.close();
  });

  test('month view collapses what does not fit into "more N" and opens the day', async ({
    browser,
  }) => {
    for (let i = 0; i < 6; i += 1) {
      await tracker.create({
        roomId: rooms[i]!.id,
        title: `E2E crowd ${i + 1}`,
        startAt: kyivInstant(week.day(2), `${9 + i}:00`),
        endAt: kyivInstant(week.day(2), `${9 + i}:45`),
      });
    }
    const ctx = await contextAs(browser, 'ana', { locale: 'en-GB' });
    const page = await ctx.newPage();
    await openCalendar(page, 'month', week.day(2));
    const cell = page.locator(`[data-date="${week.day(2)}"]`);
    await expect(cell.getByTestId('more')).toHaveText('ще 3'); // 6 events, capacity 4: 3 shown + "3 more"
    await expect(cell.locator('.event-block')).toHaveCount(3);
    await cell.getByTestId('more').click();
    await expect(page.getByTestId('view-day')).toHaveAttribute('aria-pressed', 'true');
    expect(page.url()).toContain(`date=${week.day(2)}`);
    await ctx.close();
  });
});
