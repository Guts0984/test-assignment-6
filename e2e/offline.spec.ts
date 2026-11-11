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
import { boxOf, dragBy, eventBlock, openCalendar, PX_PER_HOUR, syncState } from './helpers/ui';

/** Working without the network (assignment §3, §9; acceptance #9 and #10). */
test.describe('offline', () => {
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

  /** Opens the calendar and makes sure the offline service worker controls the page, so it can be reloaded without a network. */
  async function openControlled(page: Page, date: string) {
    await openCalendar(page, 'week', date);
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    await page.reload();
    await expect(page.getByTestId('time-grid')).toBeVisible();
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  }
  const eventRow = async (id: string) =>
    (await (await (await apiAs('ana')).get(`/api/events/${id}`)).json()).event as {
      startAt: string;
      endAt: string;
      title: string;
      version: number;
    };

  test('5 changes made offline survive a page reload and are all saved, in order, when the network returns (#9)', async ({
    browser,
  }) => {
    const ids: string[] = [];
    for (const [i, name] of ['A', 'B', 'C', 'D'].entries()) {
      const ev = await tracker.create({
        roomId: rooms[i]!.id,
        title: `E2E off ${name}`,
        startAt: kyivInstant(week.day(i), '10:00'),
        endAt: kyivInstant(week.day(i), '11:00'),
      });
      ids.push(ev.id);
    }
    const ctx = await contextAs(browser, 'ana');
    const page = await ctx.newPage();
    await openControlled(page, week.day(0));

    await ctx.setOffline(true);
    await expect(syncState(page)).toHaveAttribute('data-status', 'offline');
    const drag = async (name: string, hours: number) => {
      const box = await boxOf(eventBlock(page, `E2E off ${name}`));
      await dragBy(page, { x: box.x + 20, y: box.y + 8 }, 0, hours * PX_PER_HOUR);
    };
    await drag('A', 2); // 12:00
    await drag('A', 1); // 13:00: two successive changes of ONE event must be applied in this order
    await drag('B', 2);
    await drag('C', 2);
    await drag('D', 2);
    await expect(syncState(page)).toHaveAttribute('data-pending', '5');
    await expect(syncState(page)).toHaveAttribute('data-status', 'offline');
    expect((await eventRow(ids[0]!)).version).toBe(1); // nothing reached the server

    // Reload while still offline: the page loads from the service worker, the queue comes back from IndexedDB.
    await page.reload();
    await expect(page.getByTestId('time-grid')).toBeVisible();
    await expect(syncState(page)).toHaveAttribute('data-pending', '5');
    await expect(eventBlock(page, 'E2E off A')).toContainText('13:00'); // still drawn where I left it
    await expect(eventBlock(page, 'E2E off B')).toContainText('12:00');

    await ctx.setOffline(false);
    await expect(syncState(page)).toHaveAttribute('data-status', 'saved', { timeout: 30_000 });
    expect(await eventRow(ids[0]!)).toMatchObject({
      startAt: kyivInstant(week.day(0), '13:00'),
      version: 3,
    }); // two edits, in order
    expect(await eventRow(ids[1]!)).toMatchObject({
      startAt: kyivInstant(week.day(1), '12:00'),
      version: 2,
    });
    expect(await eventRow(ids[2]!)).toMatchObject({
      startAt: kyivInstant(week.day(2), '12:00'),
      version: 2,
    });
    expect(await eventRow(ids[3]!)).toMatchObject({
      startAt: kyivInstant(week.day(3), '12:00'),
      version: 2,
    });
    await ctx.close();
  });

  async function offlineEditThenSomeoneElseEdits(
    page: Page,
    ctxSetOffline: (v: boolean) => Promise<void>,
    id: string,
  ) {
    await ctxSetOffline(true);
    const box = await boxOf(eventBlock(page, 'E2E contested offline'));
    await dragBy(page, { x: box.x + 20, y: box.y + 8 }, 0, 2 * PX_PER_HOUR);
    await expect(syncState(page)).toHaveAttribute('data-pending', '1');
    const bob = await apiAs('bob');
    const res = await bob.patch(`/api/events/${id}`, {
      data: { version: 1, title: 'E2E renamed by Bob' },
    });
    expect(res.ok()).toBe(true);
    await ctxSetOffline(false);
  }

  test('an offline change to an event somebody else changed meanwhile opens the chooser with the differences (#10); "keep mine" applies on top', async ({
    browser,
  }) => {
    const ev = await tracker.create({
      roomId: rooms[0]!.id,
      title: 'E2E contested offline',
      startAt: kyivInstant(week.day(1), '10:00'),
      endAt: kyivInstant(week.day(1), '11:00'),
    });
    const ctx = await contextAs(browser, 'ana');
    const page = await ctx.newPage();
    await openControlled(page, week.day(1));
    await offlineEditThenSomeoneElseEdits(page, (v) => ctx.setOffline(v), ev.id);

    const dialog = page.getByTestId('conflict-dialog');
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    await expect(syncState(page)).toHaveAttribute('data-status', 'conflict');
    // The rows I changed and that now differ are highlighted: start and end. The title is Bob's, not mine.
    await expect(dialog.locator('tr[data-field=start]')).toHaveAttribute('data-differs', 'true');
    await expect(dialog.locator('tr[data-field=end]')).toHaveAttribute('data-differs', 'true');
    await expect(dialog.locator('tr[data-field=title]')).not.toHaveAttribute(
      'data-differs',
      'true',
    ); // not touched by me: shown, but not highlighted
    expect((await eventRow(ev.id)).startAt).toBe(kyivInstant(week.day(1), '10:00')); // nothing overwritten yet
    // The dialog cannot be dismissed with Escape: the queue is blocked until a choice is made.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();

    await page.getByTestId('conflict-mine').click();
    await expect(syncState(page)).toHaveAttribute('data-status', 'saved', { timeout: 20_000 });
    expect(await eventRow(ev.id)).toMatchObject({
      title: 'E2E renamed by Bob',
      startAt: kyivInstant(week.day(1), '12:00'),
      version: 3,
    });
    await ctx.close();
  });

  test('"use the server\'s": my offline change is dropped and the screen shows the other version', async ({
    browser,
  }) => {
    const ev = await tracker.create({
      roomId: rooms[1]!.id,
      title: 'E2E contested offline',
      startAt: kyivInstant(week.day(2), '10:00'),
      endAt: kyivInstant(week.day(2), '11:00'),
    });
    const ctx = await contextAs(browser, 'ana');
    const page = await ctx.newPage();
    await openControlled(page, week.day(2));
    await offlineEditThenSomeoneElseEdits(page, (v) => ctx.setOffline(v), ev.id);
    await expect(page.getByTestId('conflict-dialog')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('conflict-server').click();
    await expect(syncState(page)).toHaveAttribute('data-status', 'saved');
    await expect(eventBlock(page, 'E2E renamed by Bob')).toContainText('10:00'); // Bob's version, at its original time
    expect(await eventRow(ev.id)).toMatchObject({
      title: 'E2E renamed by Bob',
      startAt: kyivInstant(week.day(2), '10:00'),
      version: 2,
    });
    await ctx.close();
  });

  test('a fresh tab that goes offline can still open the panel, the repeat editor, settings and the scope dialog', async ({
    browser,
  }) => {
    await tracker.create({
      roomId: rooms[2]!.id,
      title: 'E2E offline series',
      tzid: 'Europe/Kyiv',
      startAt: kyivInstant(week.day(1), '10:00'),
      endAt: kyivInstant(week.day(1), '11:00'),
      rrule: 'FREQ=DAILY;COUNT=3',
    });
    const ctx = await contextAs(browser, 'ana');
    const page = await ctx.newPage();
    await openControlled(page, week.day(1));
    // The service worker downloads every build file when it is installed (including the lazy chunks the
    // page has not asked for yet): wait until it has them all, none of the dialogs was opened so far.
    const expected = await page.evaluate(async () => {
      const text = await (await fetch('/precache.js')).text();
      return (JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1)) as string[])
        .length;
    });
    expect(expected).toBeGreaterThan(5);
    await expect
      .poll(
        () => page.evaluate(async () => (await (await caches.open('static-v1')).keys()).length),
        { timeout: 30_000 },
      )
      .toBeGreaterThanOrEqual(expected);

    await ctx.setOffline(true);
    await expect(syncState(page)).toHaveAttribute('data-status', 'offline');
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    // The settings dialog (lazy).
    await page.getByTestId('open-settings').click();
    await expect(page.getByTestId('settings-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('settings-dialog')).toBeHidden();

    // The create panel (lazy) and, inside it, the repeat editor (a second lazy chunk).
    await page.getByTestId('new-event').click();
    await expect(page.getByTestId('event-panel')).toBeVisible();
    await page.getByTestId('field-repeat').selectOption('weekly');
    await expect(page.getByTestId('recurrence-editor')).toBeVisible();
    await page.getByTestId('panel-close').click();
    await page.getByTestId('discard').click(); // the form was changed: confirm throwing it away
    await expect(page.getByTestId('event-panel')).toHaveCount(0);

    // The "which occurrences?" dialog (lazy): deleting a recurring meeting asks.
    await eventBlock(page, 'E2E offline series').click();
    await page.keyboard.press('Delete');
    await expect(page.getByTestId('scope-this')).toBeVisible();
    await page.keyboard.press('Escape');

    await expect(page.getByTestId('time-grid')).toBeVisible(); // the page is still alive
    expect(pageErrors).toEqual([]);
    await ctx.close();
  });

  test('if a lazy part cannot be downloaded the user gets a message and the page keeps working', async ({
    browser,
  }) => {
    // No service worker here: the panel's code was never downloaded and cannot be fetched now.
    const ctx = await contextAs(browser, 'ana', { serviceWorkers: 'block' });
    const page = await ctx.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    await openCalendar(page, 'week', week.day(1));
    await ctx.setOffline(true);
    await page.getByTestId('new-event').click();
    await expect(page.getByTestId('toast')).toBeVisible();
    await expect(page.getByTestId('event-panel')).toHaveCount(0);
    // Nothing broke: the grid is still there and still reacts.
    await expect(page.getByTestId('time-grid')).toBeVisible();
    await page.getByTestId('open-settings').click();
    await expect(page.getByTestId('toast').first()).toBeVisible();
    expect(pageErrors).toEqual([]);
    await ctx.close();
  });
});
