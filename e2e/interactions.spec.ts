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

/** Touch, moving between rooms, multi-day events, and the live "now" line (§2 Events / Calendar). */
test.describe('interactions', () => {
  let rooms: Room[];
  let tracker: ReturnType<typeof createTracker>;
  let week: ReturnType<typeof weekOf>;

  test.beforeEach(async () => {
    week = weekOf(test.info());
    const ana = await apiAs('ana');
    // These tests read the clock off the screen: pin the profile zone and locale (Monday-first week) they assume.
    await ana.patch('/api/me', { data: { timezone: 'Europe/Kyiv', locale: 'uk' } });
    rooms = await getRooms(ana);
    await sweepWeek(ana, week.from, week.wideTo);
    tracker = createTracker(ana);
  });
  test.afterEach(async () => {
    await tracker.cleanup();
    await sweepWeek(await apiAs('ana'), week.from, week.wideTo);
  });

  const row = async (id: string) =>
    (await (await (await apiAs('ana')).get(`/api/events/${id}`)).json()).event as {
      roomId: string;
      startAt: string;
      endAt: string;
      version: number;
    };

  /** A finger on `from`: press, optionally wait, move to (dx, dy), lift. Real PointerEvents of type touch. */
  async function touch(
    page: Page,
    from: { x: number; y: number },
    to: { dx: number; dy: number },
    holdMs: number,
  ) {
    await page.evaluate(
      async ({ from, to, holdMs }) => {
        const fire = (target: EventTarget, type: string, x: number, y: number) =>
          target.dispatchEvent(
            new PointerEvent(type, {
              bubbles: true,
              cancelable: true,
              pointerId: 7,
              pointerType: 'touch',
              isPrimary: true,
              clientX: x,
              clientY: y,
              button: 0,
              buttons: type === 'pointerup' ? 0 : 1,
            }),
          );
        const start = document.elementFromPoint(from.x, from.y)!;
        fire(start, 'pointerdown', from.x, from.y);
        await new Promise((r) => setTimeout(r, holdMs));
        for (let i = 1; i <= 6; i++)
          fire(window, 'pointermove', from.x + (to.dx * i) / 6, from.y + (to.dy * i) / 6);
        fire(window, 'pointerup', from.x + to.dx, from.y + to.dy);
      },
      { from, to, holdMs },
    );
  }

  test('touch: press-and-hold then drag moves an event; a quick swipe only scrolls', async ({
    browser,
  }) => {
    const ev = await tracker.create({
      roomId: rooms[0]!.id,
      title: 'E2E touch',
      startAt: kyivInstant(week.day(1), '10:00'),
      endAt: kyivInstant(week.day(1), '11:00'),
    });
    const ctx = await contextAs(browser, 'ana', { hasTouch: true });
    const page = await ctx.newPage();
    await openCalendar(page, 'week', week.day(1));
    const box = await boxOf(eventBlock(page, 'E2E touch'));
    const from = { x: box.x + box.width / 2, y: box.y + 10 };

    // A swipe that starts moving before the hold time is a scroll: the event must stay where it is.
    await touch(page, from, { dx: 0, dy: 2 * PX_PER_HOUR }, 0);
    await page.waitForTimeout(500);
    expect((await row(ev.id)).startAt).toBe(kyivInstant(week.day(1), '10:00'));
    expect((await row(ev.id)).version).toBe(1);

    // Press, hold, drag two hours down: the event moves (and keeps its 15-minute grid).
    await touch(page, from, { dx: 0, dy: 2 * PX_PER_HOUR }, 450);
    await expect
      .poll(async () => (await row(ev.id)).startAt)
      .toBe(kyivInstant(week.day(1), '12:00'));
    await expect.poll(async () => (await row(ev.id)).endAt).toBe(kyivInstant(week.day(1), '13:00'));
    await ctx.close();
  });

  test('day view: dragging sideways moves the meeting to another room', async ({ browser }) => {
    const ev = await tracker.create({
      roomId: rooms[0]!.id,
      title: 'E2E room move',
      startAt: kyivInstant(week.day(2), '10:00'),
      endAt: kyivInstant(week.day(2), '11:00'),
    });
    const ctx = await contextAs(browser, 'ana', { viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    await openCalendar(page, 'day', week.day(2), [rooms[0]!.id, rooms[1]!.id, rooms[2]!.id]);
    const block = await boxOf(eventBlock(page, 'E2E room move'));
    const columns = page.locator('[data-column-id]');
    const [c0, c2] = [await columns.nth(0).boundingBox(), await columns.nth(2).boundingBox()];
    await dragBy(page, { x: block.x + 20, y: block.y + 8 }, c2!.x - c0!.x, 0);
    await expect.poll(async () => (await row(ev.id)).roomId).toBe(rooms[2]!.id);
    // Only the room changed: the time is untouched.
    expect((await row(ev.id)).startAt).toBe(kyivInstant(week.day(2), '10:00'));
    await ctx.close();
  });

  test('a timed meeting across midnight is drawn on both days; an all-day one spans its days in the all-day row', async ({
    browser,
  }) => {
    await tracker.create({
      roomId: rooms[0]!.id,
      title: 'E2E overnight',
      startAt: kyivInstant(week.day(1), '22:00'),
      endAt: kyivInstant(week.day(3), '10:00'), // two nights: three days
    });
    await tracker.create({
      roomId: rooms[1]!.id,
      title: 'E2E offsite',
      // Whole UTC days (an all-day event is a range of dates in its own zone; UTC has no clock changes).
      tzid: 'UTC',
      startAt: `${week.day(4)}T00:00:00Z`,
      endAt: `${week.day(7)}T00:00:00Z`, // days 4, 5, 6
      allDay: true,
    });
    const ctx = await contextAs(browser, 'ana', { viewport: { width: 1400, height: 900 } });
    const page = await ctx.newPage();
    await openCalendar(page, 'week', week.day(0));
    const dayColumns = page.locator('[data-column-id]');
    const timedIn = (i: number) =>
      dayColumns.nth(i).locator('.event-block', { hasText: 'E2E overnight' });
    // Monday = day 0. The meeting runs Tue 22:00 -> Thu 10:00.
    await expect(timedIn(0)).toHaveCount(0);
    for (const i of [1, 2, 3]) await expect(timedIn(i)).toHaveCount(1);
    await expect(timedIn(4)).toHaveCount(0);
    // Whole Wednesday: from midnight to midnight.
    const wed = await timedIn(2).boundingBox();
    expect(Math.round(wed!.height)).toBeGreaterThanOrEqual(24 * PX_PER_HOUR - 4);
    // The all-day meeting is in the all-day row on Fri, Sat, Sun (columns 4..6), nowhere else.
    const allDay = page.locator('.event-block[data-allday="true"]', { hasText: 'E2E offsite' });
    await expect(allDay).toHaveCount(3);
    await ctx.close();
  });

  test('the "now" line is drawn at the current time and moves on its own, without a reload', async ({
    browser,
  }) => {
    const ctx = await contextAs(browser, 'ana', { viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    // 15:00 Kyiv on the test's Wednesday, then let the page's own timers run on a fake clock.
    await page.clock.install({ time: new Date(kyivInstant(week.day(2), '15:00')) });
    await openCalendar(page, 'week', week.day(2));
    const line = page.getByTestId('now-line');
    await expect(line).toHaveCount(1);
    const topOf = () => line.evaluate((el) => parseFloat((el as HTMLElement).style.top));
    expect(await topOf()).toBeCloseTo(15 * PX_PER_HOUR, 0);
    await page.clock.fastForward('30:00'); // half an hour passes
    await expect.poll(topOf).toBeCloseTo(15.5 * PX_PER_HOUR, 0);
    // Past midnight the line leaves this day: only the day that contains "now" has it.
    await page.clock.fastForward('09:00:00');
    await expect(line).toHaveCount(1);
    expect(await topOf()).toBeCloseTo(0.5 * PX_PER_HOUR, 0);
    await ctx.close();
  });

  /** Tue 22:00 -> Wed 10:00 Kyiv: two pieces (2 h on Tuesday, 10 h on Wednesday). */
  async function overnight(title: string) {
    return tracker.create({
      roomId: rooms[0]!.id,
      title,
      startAt: kyivInstant(week.day(1), '22:00'),
      endAt: kyivInstant(week.day(2), '10:00'),
    });
  }

  test('a meeting across midnight keeps its length when its SECOND piece is dragged with the mouse', async ({
    browser,
  }) => {
    const ev = await overnight('E2E overnight mouse');
    const ctx = await contextAs(browser, 'ana', { viewport: { width: 1400, height: 900 } });
    const page = await ctx.newPage();
    await openCalendar(page, 'week', week.day(0));
    const piece = page
      .locator('[data-column-id]')
      .nth(2) // Wednesday
      .locator('.event-block', { hasText: 'E2E overnight mouse' });
    const box = await boxOf(piece);
    // Grab it at 08:00 and drag it one hour down: the whole meeting must move one hour, no more.
    await dragBy(page, { x: box.x + 20, y: box.y + 8 * PX_PER_HOUR }, 0, PX_PER_HOUR);
    await expect(page.getByTestId('sync-indicator')).toHaveAttribute('data-status', 'saved');
    expect(await row(ev.id)).toMatchObject({
      startAt: kyivInstant(week.day(1), '23:00'),
      endAt: kyivInstant(week.day(2), '11:00'),
    });
    await ctx.close();
  });

  test('a meeting across midnight is not cut off at midnight when moved with the keyboard', async ({
    browser,
  }) => {
    const ev = await overnight('E2E overnight keys');
    const ctx = await contextAs(browser, 'ana', { viewport: { width: 1400, height: 900 } });
    const page = await ctx.newPage();
    await openCalendar(page, 'week', week.day(0));
    await eventBlock(page, 'E2E overnight keys').focus(); // the Tuesday piece comes first in the page
    await page.keyboard.press('Space'); // pick it up
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowUp'); // one hour earlier
    await page.keyboard.press('Enter'); // drop
    await expect(page.getByTestId('sync-indicator')).toHaveAttribute('data-status', 'saved');
    expect(await row(ev.id)).toMatchObject({
      startAt: kyivInstant(week.day(1), '21:00'),
      endAt: kyivInstant(week.day(2), '09:00'), // the Wednesday part survived
    });
    await ctx.close();
  });
});
