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
import {
  boxOf,
  dragBy,
  eventBlock,
  liveText,
  openCalendar,
  PX_PER_HOUR,
  SLOT_PX,
} from './helpers/ui';

/**
 * Create, move and resize with the MOUSE and with the KEYBOARD (assignment §9, acceptance #15).
 * Each test works in its own week and removes what it made.
 */
test.describe('create, move, resize', () => {
  let rooms: Room[];
  let tracker: ReturnType<typeof createTracker>;
  let week: ReturnType<typeof weekOf>;

  test.beforeEach(async () => {
    const testInfo = test.info();
    const api = await apiAs('ana');
    rooms = await getRooms(api);
    week = weekOf(testInfo);
    await sweepWeek(api, week.from, week.wideTo);
    tracker = createTracker(api);
  });
  test.afterEach(async () => tracker.cleanup());

  const rowOf = async (id: string) => {
    const api = await apiAs('ana');
    const res = await api.get(`/api/events/${id}`);
    return (await res.json()).event as {
      startAt: string;
      endAt: string;
      roomId: string;
      version: number;
      title: string;
    };
  };

  test('drag on an empty slot creates an event through the panel', async ({ browser }) => {
    const ctx = await contextAs(browser, 'ana');
    const page = await ctx.newPage();
    await openCalendar(page, 'week', week.day(1));
    // Tuesday column, 10:00 -> 11:30 (grid opens scrolled to 07:00, one hour = 48px)
    const column = page.locator('[data-column-id]').nth(1);
    const box = await boxOf(column);
    // The column's box is measured in the viewport, so it already reflects how far the grid is scrolled.
    const y = (hour: number) => box.y + hour * PX_PER_HOUR;
    // from 10:02 to 11:28: the range is widened to whole 15-minute slots (start floored, end ceiled)
    await dragBy(page, { x: box.x + box.width / 2, y: y(10) + 2 }, 0, 1.5 * PX_PER_HOUR - 6);
    await expect(page.getByTestId('event-panel')).toBeVisible();
    await expect(page.getByTestId('field-start-time')).toHaveValue('10:00');
    await expect(page.getByTestId('field-end-time')).toHaveValue('11:30');
    await page.getByTestId('field-title').fill('E2E drawn event');
    await page.getByTestId('field-room').selectOption(rooms[3]!.id);
    await page.getByTestId('panel-save').click();
    await expect(eventBlock(page, 'E2E drawn event')).toBeVisible();
    await expect(page.getByTestId('sync-indicator')).toHaveAttribute('data-status', 'saved');
    const api = await apiAs('ana');
    const list = await (await api.get(`/api/events?from=${week.from}&to=${week.to}`)).json();
    const made = list.occurrences.find((o: { title: string }) => o.title === 'E2E drawn event');
    expect(made).toMatchObject({
      start: kyivInstant(week.day(1), '10:00'),
      end: kyivInstant(week.day(1), '11:30'),
      roomId: rooms[3]!.id,
    });
    tracker.track(made.eventId);
    await ctx.close();
  });

  test('dragging an event with the mouse moves it (time and day) and Ctrl+Z puts it back, server included', async ({
    browser,
  }) => {
    const ev = await tracker.create({
      roomId: rooms[0]!.id,
      title: 'E2E mouse move',
      startAt: kyivInstant(week.day(0), '10:00'),
      endAt: kyivInstant(week.day(0), '11:00'),
    });
    const ctx = await contextAs(browser, 'ana');
    const page = await ctx.newPage();
    await openCalendar(page, 'week', week.day(0));
    const block = eventBlock(page, 'E2E mouse move');
    const box = await boxOf(block);
    const colWidth =
      (await boxOf(page.locator('[data-column-id]').nth(1))).x -
      (await boxOf(page.locator('[data-column-id]').nth(0))).x;
    // two days to the right, two hours (8 slots) down
    await dragBy(page, { x: box.x + box.width / 2, y: box.y + 8 }, 2 * colWidth, 2 * PX_PER_HOUR);
    await expect(page.getByTestId('sync-indicator')).toHaveAttribute('data-status', 'saved');
    expect(await rowOf(ev.id)).toMatchObject({
      startAt: kyivInstant(week.day(2), '12:00'),
      endAt: kyivInstant(week.day(2), '13:00'),
      version: 2,
    });

    await page.keyboard.press('Control+z');
    await expect
      .poll(async () => (await rowOf(ev.id)).startAt)
      .toBe(kyivInstant(week.day(0), '10:00'));
    await expect(page.getByTestId('sync-indicator')).toHaveAttribute('data-status', 'saved');
    expect((await rowOf(ev.id)).endAt).toBe(kyivInstant(week.day(0), '11:00'));
    // the screen agrees with the server
    await expect(eventBlock(page, 'E2E mouse move')).toContainText('10:00');
    await page.keyboard.press('Control+Shift+z'); // redo
    await expect
      .poll(async () => (await rowOf(ev.id)).startAt)
      .toBe(kyivInstant(week.day(2), '12:00'));
    await ctx.close();
  });

  test('dragging the bottom edge changes the duration in 15-minute steps; undo restores it', async ({
    browser,
  }) => {
    const ev = await tracker.create({
      roomId: rooms[1]!.id,
      title: 'E2E mouse resize',
      startAt: kyivInstant(week.day(1), '10:00'),
      endAt: kyivInstant(week.day(1), '11:00'),
    });
    const ctx = await contextAs(browser, 'ana');
    const page = await ctx.newPage();
    await openCalendar(page, 'week', week.day(1));
    const block = eventBlock(page, 'E2E mouse resize');
    const box = await boxOf(block);
    await dragBy(page, { x: box.x + box.width / 2, y: box.y + box.height - 2 }, 0, 2 * SLOT_PX + 3); // +30 minutes (+3px of slop)
    await expect(page.getByTestId('sync-indicator')).toHaveAttribute('data-status', 'saved');
    expect(await rowOf(ev.id)).toMatchObject({
      startAt: kyivInstant(week.day(1), '10:00'),
      endAt: kyivInstant(week.day(1), '11:30'),
    });
    expect(await liveText(page)).not.toBe('');
    await page.keyboard.press('Control+z');
    await expect
      .poll(async () => (await rowOf(ev.id)).endAt)
      .toBe(kyivInstant(week.day(1), '11:00'));
    await ctx.close();
  });

  test('a drag cancelled with Escape changes nothing', async ({ browser }) => {
    const ev = await tracker.create({
      roomId: rooms[2]!.id,
      title: 'E2E escape',
      startAt: kyivInstant(week.day(2), '10:00'),
      endAt: kyivInstant(week.day(2), '11:00'),
    });
    const ctx = await contextAs(browser, 'ana');
    const page = await ctx.newPage();
    await openCalendar(page, 'week', week.day(2));
    const box = await boxOf(eventBlock(page, 'E2E escape'));
    await page.mouse.move(box.x + 20, box.y + 8);
    await page.mouse.down();
    await page.mouse.move(box.x + 20, box.y + 8 + 100, { steps: 5 });
    await expect(page.getByTestId('drag-ghost')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('drag-ghost')).toHaveCount(0);
    await page.mouse.up();
    await page.waitForTimeout(300);
    expect((await rowOf(ev.id)).version).toBe(1);
    await ctx.close();
  });

  test('keyboard only: create an event, then pick it up, move it and drop it (with announcements)', async ({
    browser,
  }) => {
    const ctx = await contextAs(browser, 'ana');
    const page = await ctx.newPage();
    await openCalendar(page, 'week', week.day(3));
    await page.getByTestId('time-grid').focus();
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowDown'); // 09:00 -> 10:00
    await page.keyboard.press('ArrowRight');
    expect(await liveText(page)).toMatch(/10:00/); // the cursor position is announced
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('event-panel')).toBeVisible();
    await page.getByTestId('field-title').fill('E2E keyboard event');
    await page.getByTestId('field-room').selectOption(rooms[4]!.id);
    await page.getByTestId('panel-save').click();
    const block = eventBlock(page, 'E2E keyboard event');
    await expect(block).toBeVisible();
    await expect(page.getByTestId('sync-indicator')).toHaveAttribute('data-status', 'saved');
    const api = await apiAs('ana');
    const made = (
      await (await api.get(`/api/events?from=${week.from}&to=${week.to}`)).json()
    ).occurrences.find((o: { title: string }) => o.title === 'E2E keyboard event');
    tracker.track(made.eventId);
    expect(made.start).toBe(kyivInstant(week.day(1), '10:00')); // one ArrowRight from the first column = Tuesday

    await block.focus();
    await page.keyboard.press('Space');
    expect(await liveText(page)).toMatch(/E2E keyboard event/);
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowDown'); // +1 hour
    await page.keyboard.press('ArrowRight'); // next day
    await page.keyboard.press('Shift+ArrowDown'); // +15 min long
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('sync-indicator')).toHaveAttribute('data-status', 'saved');
    expect(await rowOf(made.eventId)).toMatchObject({
      startAt: kyivInstant(week.day(2), '11:00'),
      endAt: kyivInstant(week.day(2), '12:15'),
    });
    await ctx.close();
  });
});
