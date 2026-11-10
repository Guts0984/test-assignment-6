import { expect, test } from '@playwright/test';
import {
  apiAs,
  contextAs,
  createTracker,
  getRooms,
  kyivInstant,
  nyInstant,
  sweepWeek,
  weekOf,
  type Room,
} from './helpers/api';
import { boxOf, dragBy, eventBlock, openCalendar, PX_PER_HOUR } from './helpers/ui';

/** Two people at once (assignment §9, acceptance #7 and #11). */
test.describe('two browsers', () => {
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

  test('the same room at the same time: one booking succeeds, the other rolls back and names who is in the way (#7)', async ({
    browser,
  }) => {
    const anaCtx = await contextAs(browser, 'ana');
    const bobCtx = await contextAs(browser, 'bob', { locale: 'en-US' });
    const bob = await bobCtx.newPage();
    // Bob must not hear about Ana's booking before he tries his own: that is the race.
    await bob.route('**/api/stream', (route) => route.abort());
    await openCalendar(bob, 'week', week.day(1));
    await expect(bob.getByTestId('time-grid')).toBeVisible();

    const anaApi = await anaCtx.request;
    const res = await anaApi.post('/api/events', {
      data: {
        roomId: rooms[0]!.id,
        title: 'E2E Ana booked first',
        // 10:30-11:30 New York time: Bob works in New York and will ask for 11:00-12:00 there.
        startAt: nyInstant(week.day(1), '10:30'),
        endAt: nyInstant(week.day(1), '11:30'),
      },
    });
    expect(res.status()).toBe(201);
    tracker.track((await res.json()).events[0].id);

    // Bob books the same room at an overlapping time through the panel.
    await bob.getByTestId('new-event').click();
    await bob.getByTestId('field-title').fill('E2E Bob too late');
    await bob.getByTestId('field-room').selectOption(rooms[0]!.id);
    await bob.getByTestId('field-start-date').fill(week.day(1));
    await bob.getByTestId('field-end-date').fill(week.day(1));
    await bob.getByTestId('field-start-time').fill('11:00 AM'); // New York time, overlapping Ana's 10:30-11:30
    await bob.getByTestId('field-end-time').fill('12:00 PM');
    await bob.getByTestId('panel-save').click();

    // Bob sees his event appear (optimistic) and then disappear again, with an explanation.
    const toast = bob.getByTestId('toast').first();
    await expect(toast).toBeVisible();
    await expect(toast).toHaveAttribute('data-code', 'ROOM_CONFLICT');
    await expect(toast).toContainText('E2E Ana booked first');
    await expect(toast).toContainText('Ana');
    await expect(eventBlock(bob, 'E2E Bob too late')).toHaveCount(0);
    await expect(bob.getByTestId('sync-indicator')).toHaveAttribute('data-status', 'saved');

    // Only Ana's booking exists on the server.
    const list = await (await anaApi.get(`/api/events?from=${week.from}&to=${week.to}`)).json();
    const ours = list.occurrences.filter((o: { title: string }) => o.title.startsWith('E2E')); // the seed's open-ended series also appear
    expect(ours.map((o: { title: string }) => o.title)).toEqual(['E2E Ana booked first']);
    await anaCtx.close();
    await bobCtx.close();
  });

  test("a stale edit is refused: the screen shows the other person's version and says so", async ({
    browser,
  }) => {
    const ev = await tracker.create({
      roomId: rooms[1]!.id,
      title: 'E2E contested',
      startAt: kyivInstant(week.day(2), '10:00'),
      endAt: kyivInstant(week.day(2), '11:00'),
    });
    const bobCtx = await contextAs(browser, 'bob', { locale: 'en-US' });
    const bob = await bobCtx.newPage();
    await bob.route('**/api/stream', (route) => route.abort()); // Bob cannot see Ana's change coming
    await openCalendar(bob, 'week', week.day(2));
    const ana = await apiAs('ana');
    await ana.patch(`/api/events/${ev.id}`, { data: { version: 1, title: 'E2E renamed by Ana' } });

    const box = await boxOf(eventBlock(bob, 'E2E contested'));
    await dragBy(bob, { x: box.x + 20, y: box.y + 8 }, 0, 2 * PX_PER_HOUR);
    const toast = bob.getByTestId('toast').first();
    await expect(toast).toHaveAttribute('data-code', 'VERSION_CONFLICT');
    await expect(eventBlock(bob, 'E2E renamed by Ana')).toBeVisible(); // reconciled with the server
    await expect(eventBlock(bob, 'E2E contested')).toHaveCount(0);
    const row = await (await ana.get(`/api/events/${ev.id}`)).json();
    expect(row.event).toMatchObject({
      title: 'E2E renamed by Ana',
      startAt: kyivInstant(week.day(2), '10:00'),
      version: 2,
    });
    await bobCtx.close();
  });

  test('a change in another browser appears without a reload (#11)', async ({ browser }) => {
    const ev = await tracker.create({
      roomId: rooms[2]!.id,
      title: 'E2E live',
      startAt: kyivInstant(week.day(3), '10:00'),
      endAt: kyivInstant(week.day(3), '11:00'),
    });
    const anaCtx = await contextAs(browser, 'ana');
    const ana = await anaCtx.newPage();
    await openCalendar(ana, 'week', week.day(3));
    await expect(eventBlock(ana, 'E2E live')).toBeVisible();
    await ana.evaluate(
      () => ((window as unknown as { __marker: string }).__marker = 'same document'),
    );

    const bob = await apiAs('bob');
    await bob.patch(`/api/events/${ev.id}`, {
      data: {
        version: 1,
        title: 'E2E live (edited by Bob)',
        startAt: kyivInstant(week.day(3), '13:00'),
        endAt: kyivInstant(week.day(3), '14:00'),
      },
    });
    await expect(eventBlock(ana, 'E2E live (edited by Bob)')).toBeVisible({ timeout: 8_000 });
    await expect(eventBlock(ana, 'E2E live (edited by Bob)')).toContainText('13:00');

    const made = await bob.post('/api/events', {
      data: {
        roomId: rooms[3]!.id,
        title: 'E2E created by Bob',
        startAt: kyivInstant(week.day(3), '15:00'),
        endAt: kyivInstant(week.day(3), '16:00'),
      },
    });
    tracker.track((await made.json()).events[0].id);
    await expect(eventBlock(ana, 'E2E created by Bob')).toBeVisible({ timeout: 8_000 });
    expect(await ana.evaluate(() => (window as unknown as { __marker?: string }).__marker)).toBe(
      'same document',
    ); // never reloaded
    await anaCtx.close();
  });

  test('my own change coming back over SSE does not make the event flicker (#11)', async ({
    browser,
  }) => {
    await tracker.create({
      roomId: rooms[4]!.id,
      title: 'E2E steady',
      startAt: kyivInstant(week.day(4), '10:00'),
      endAt: kyivInstant(week.day(4), '11:00'),
    });
    const ctx = await contextAs(browser, 'ana');
    const page = await ctx.newPage();
    await openCalendar(page, 'week', week.day(4));
    const block = eventBlock(page, 'E2E steady');
    const box = await boxOf(block);
    // What a person would SEE as flicker: any animation frame in which the event is not on the page.
    await page.evaluate(() => {
      const w = window as unknown as { __missing: number; __stop: boolean };
      w.__missing = 0;
      w.__stop = false;
      const tick = () => {
        const present = [...document.querySelectorAll('.event-block')].some((el) =>
          (el.textContent ?? '').includes('E2E steady'),
        );
        if (!present) w.__missing += 1;
        if (!w.__stop) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await dragBy(page, { x: box.x + 20, y: box.y + 8 }, 0, PX_PER_HOUR); // same column, one hour later
    await expect(page.getByTestId('sync-indicator')).toHaveAttribute('data-status', 'saved');
    await page.waitForTimeout(1500); // the echo of our own change arrives over SSE in this window
    const missing = await page.evaluate(() => {
      const w = window as unknown as { __missing: number; __stop: boolean };
      w.__stop = true;
      return w.__missing;
    });
    expect(missing, 'frames in which the event was not on screen').toBe(0);
    await expect(eventBlock(page, 'E2E steady')).toContainText('11:00');
    await ctx.close();
  });
});
