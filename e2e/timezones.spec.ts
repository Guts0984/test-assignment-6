import { expect, test, type ConsoleMessage } from '@playwright/test';
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
  type Who,
} from './helpers/api';
import { eventBlock, openCalendar } from './helpers/ui';

/** Time zones (assignment §2, §6; acceptance #4, #5, #18). */
test.describe('time zones', () => {
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
    const ana = await apiAs('ana');
    await ana.patch('/api/me', { data: { timezone: 'Europe/Kyiv', locale: 'uk' } }); // restore the profile
    await sweepWeek(ana, week.from, week.wideTo);
  });

  const clock = (iso: string, timeZone: string) =>
    new Date(iso).toLocaleTimeString('en-GB', { timeZone, hour: '2-digit', minute: '2-digit' });
  /** What the calendar prints: 24-hour for the Ukrainian locale (Ana), 12-hour for the English one (Bob, Kenji). */
  const printed = (who: Who, iso: string, timeZone: string) =>
    who === 'ana'
      ? clock(iso, timeZone)
      : new Date(iso).toLocaleTimeString('en-US', { timeZone, hour: 'numeric', minute: '2-digit' });
  const day = (iso: string, timeZone: string) =>
    new Date(iso).toLocaleDateString('en-CA', { timeZone });

  test('a user in Tokyo sees a 23:30 New York meeting on the right day and time (#4)', async ({
    browser,
  }) => {
    const bob = await apiAs('bob');
    const startAt = nyInstant(week.day(2), '23:30');
    const endAt = nyInstant(week.day(3), '00:30');
    const res = await bob.post('/api/events', {
      data: {
        roomId: rooms[0]!.id,
        title: 'E2E late call',
        startAt,
        endAt,
        tzid: 'America/New_York',
      },
    });
    tracker.track((await res.json()).events[0].id);

    const kenjiCtx = await contextAs(browser, 'kenji', { locale: 'en-GB' });
    const kenji = await kenjiCtx.newPage();
    await openCalendar(kenji, 'week', week.day(2));
    const block = eventBlock(kenji, 'E2E late call');
    await expect(block).toBeVisible();
    const expectedDay = day(startAt, 'Asia/Tokyo');
    expect(
      await block.evaluate((el) => el.closest('[data-column-id]')?.getAttribute('data-column-id')),
    ).toBe(expectedDay); // the Tokyo date, not the New York one
    await expect(block).toContainText(clock(startAt, 'Asia/Tokyo'));
    expect(expectedDay).not.toBe(day(startAt, 'America/New_York')); // it really is a different calendar day there

    // ...and Bob (New York) sees the same meeting on HIS day, crossing midnight into the next one.
    const bobCtx = await contextAs(browser, 'bob', { locale: 'en-US' });
    const bobPage = await bobCtx.newPage();
    await openCalendar(bobPage, 'week', week.day(2));
    const columns = await bobPage
      .locator('.event-block', { hasText: 'E2E late call' })
      .evaluateAll((els) =>
        els.map((e) => e.closest('[data-column-id]')?.getAttribute('data-column-id')),
      );
    expect(columns).toEqual([day(startAt, 'America/New_York'), day(endAt, 'America/New_York')]);
    await kenjiCtx.close();
    await bobCtx.close();
  });

  test('changing the time zone in the profile re-lays out the calendar at once, without a reload (#5)', async ({
    browser,
  }) => {
    const startAt = kyivInstant(week.day(1), '10:00');
    await tracker.create({
      roomId: rooms[1]!.id,
      title: 'E2E zone switch',
      startAt,
      endAt: kyivInstant(week.day(1), '11:00'),
    });
    const ctx = await contextAs(browser, 'ana', { locale: 'en-GB' });
    const page = await ctx.newPage();
    await openCalendar(page, 'week', week.day(1));
    await expect(eventBlock(page, 'E2E zone switch')).toContainText('10:00');
    await page.evaluate(() => ((window as unknown as { __doc: string }).__doc = 'same document'));

    await page.getByTestId('open-settings').click();
    await page.getByTestId('setting-timezone').selectOption('Asia/Tokyo');
    await page.getByTestId('settings-save').click();
    await expect(eventBlock(page, 'E2E zone switch')).toContainText(clock(startAt, 'Asia/Tokyo'));
    expect(await page.evaluate(() => (window as unknown as { __doc?: string }).__doc)).toBe(
      'same document',
    ); // no reload happened
    const me = await (await (await apiAs('ana')).get('/api/me')).json();
    expect(me.user.timezone).toBe('Asia/Tokyo'); // stored in the PROFILE

    await page.reload(); // the server renders in the profile zone from the first byte
    await expect(eventBlock(page, 'E2E zone switch')).toContainText(clock(startAt, 'Asia/Tokyo'));
    await ctx.close();
  });

  test('a second time axis can be shown next to the first', async ({ browser }) => {
    const ctx = await contextAs(browser, 'ana', { locale: 'en-GB' });
    const page = await ctx.newPage();
    await openCalendar(page, 'week', week.day(1));
    await page.getByTestId('open-settings').click();
    await page.getByTestId('setting-tz2').selectOption('America/New_York');
    await page.getByTestId('settings-save').click();
    const axes = page
      .locator(
        '[data-testid=time-grid] > div > div.sticky.left-0, [data-testid=time-grid] > div > div.sticky.z-10',
      )
      .filter({ has: page.locator('[aria-hidden=true]') });
    await expect(axes).toHaveCount(2);
    await ctx.close();
  });

  for (const [who, profileZone, browserZone] of [
    ['ana', 'Europe/Kyiv', 'Asia/Tokyo'],
    ['bob', 'America/New_York', 'Europe/Kyiv'],
    ['kenji', 'Asia/Tokyo', 'America/New_York'],
  ] as [Who, string, string][]) {
    test(`${who}: first paint is rendered in the PROFILE zone (${profileZone}) even if the browser is in ${browserZone}, with no hydration errors (#18)`, async ({
      browser,
    }) => {
      const startAt = kyivInstant(week.day(2), '10:00');
      await tracker.create({
        roomId: rooms[2]!.id,
        title: 'E2E zone paint',
        startAt,
        endAt: kyivInstant(week.day(2), '11:00'),
      });
      const ctx = await contextAs(browser, who, { timezoneId: browserZone, locale: 'en-GB' });
      const page = await ctx.newPage();
      const problems: string[] = [];
      page.on(
        'console',
        (m: ConsoleMessage) => ['error', 'warning'].includes(m.type()) && problems.push(m.text()),
      );
      page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
      await openCalendar(page, 'week', week.day(2));
      await expect(eventBlock(page, 'E2E zone paint')).toContainText(
        printed(who, startAt, profileZone),
      );
      await page.reload();
      await expect(eventBlock(page, 'E2E zone paint')).toBeVisible();
      await page.waitForTimeout(500);
      expect(
        problems.filter((p) => /hydrat|did not match|server rendered text/i.test(p)),
        'hydration problems',
      ).toEqual([]);
      expect(
        problems.filter((p) => p.startsWith('pageerror')),
        'uncaught errors',
      ).toEqual([]);
      await ctx.close();
    });
  }
});
