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

/** Locale, clock and URL behaviour (acceptance #17 and #19). */
test.describe('locale, clock and URL', () => {
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
    await ana.patch('/api/me', { data: { timezone: 'Europe/Kyiv', locale: 'uk' } });
    await sweepWeek(ana, week.from, week.wideTo);
  });

  const headers = (page: import('@playwright/test').Page) =>
    page
      .locator(
        '[data-testid=time-grid] [data-today], [data-testid=time-grid] > div > div.sticky.top-0.z-20',
      )
      .allInnerTexts();

  test('Ukrainian: the week starts on Monday and times use the 24-hour clock; English: Sunday and AM/PM', async ({
    browser,
  }) => {
    await tracker.create({
      roomId: rooms[0]!.id,
      title: 'E2E clock',
      startAt: kyivInstant(week.day(1), '14:30'),
      endAt: kyivInstant(week.day(1), '15:30'),
    });
    const uk = await contextAs(browser, 'ana');
    const ukPage = await uk.newPage();
    await openCalendar(ukPage, 'week', week.day(1));
    await expect(ukPage.locator('html')).toHaveAttribute('lang', 'uk');
    expect((await headers(ukPage))[0]).toMatch(/^Пн/);
    await expect(eventBlock(ukPage, 'E2E clock')).toContainText('14:30 – 15:30');

    // Bob's profile language is English (and his zone New York, so compare the weekday header and the AM/PM style).
    const en = await contextAs(browser, 'bob', { locale: 'en-US' });
    const enPage = await en.newPage();
    await openCalendar(enPage, 'week', week.day(1));
    await expect(enPage.locator('html')).toHaveAttribute('lang', 'en');
    expect((await headers(enPage))[0]).toMatch(/^Sun/);
    await expect(eventBlock(enPage, 'E2E clock')).toContainText(
      /\d{1,2}:\d{2} (AM|PM) – \d{1,2}:\d{2} (AM|PM)/,
    );
    await uk.close();
    await en.close();
  });

  test('switching language and clock in the settings applies immediately', async ({ browser }) => {
    await tracker.create({
      roomId: rooms[1]!.id,
      title: 'E2E switch',
      startAt: kyivInstant(week.day(1), '14:30'),
      endAt: kyivInstant(week.day(1), '15:30'),
    });
    const ctx = await contextAs(browser, 'ana');
    const page = await ctx.newPage();
    await openCalendar(page, 'week', week.day(1));
    await page.getByTestId('open-settings').click();
    await page.getByTestId('setting-clock').selectOption('12h');
    await page.getByTestId('settings-save').click();
    await expect(eventBlock(page, 'E2E switch')).toContainText('2:30 пп – 3:30 пп'); // 12-hour clock with Ukrainian day-period labels

    await page.getByTestId('open-settings').click();
    await page.getByTestId('setting-locale').selectOption('en');
    await page.getByTestId('setting-clock').selectOption('24h');
    await page.getByTestId('settings-save').click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en', { timeout: 10_000 });
    await expect(page.getByTestId('view-week')).toHaveText('Week');
    expect((await headers(page))[0]).toMatch(/^Sun/); // English weeks start on Sunday
    await ctx.close();
  });

  test('view, date and room filter are in the URL, and Back / Forward walk through them (#19)', async ({
    browser,
  }) => {
    const ctx = await contextAs(browser, 'ana');
    const page = await ctx.newPage();
    await openCalendar(page, 'week', week.day(1));
    const title = () => page.getByTestId('range-title').innerText();
    const week1 = await title();
    await page.getByTestId('view-month').click();
    expect(page.url()).toMatch(/view=month/);
    await page.getByRole('button', { name: 'Далі' }).click();
    const nextMonth = await title();
    expect(page.url()).toMatch(/view=month&date=\d{4}-\d{2}-01/);
    await page.getByTestId('view-day').click();
    expect(page.url()).toMatch(/view=day/);

    await page.goBack();
    await expect(page.getByTestId('view-month')).toHaveAttribute('aria-pressed', 'true');
    expect(await title()).toBe(nextMonth);
    await page.goBack();
    expect(await title()).not.toBe(nextMonth);
    await page.goBack();
    await expect(page.getByTestId('view-week')).toHaveAttribute('aria-pressed', 'true');
    expect(await title()).toBe(week1);
    await page.goForward();
    await expect(page.getByTestId('view-month')).toHaveAttribute('aria-pressed', 'true');
    // a URL typed by hand works, and a room filter in it is honoured
    await page.goto(`/calendar?view=day&date=${week.day(1)}&rooms=${rooms[0]!.id},${rooms[1]!.id}`);
    await expect(page.locator('[data-testid=time-grid] [data-column-id]')).toHaveCount(2);
    await ctx.close();
  });

  test('garbage in the URL falls back to sensible defaults instead of an error page', async ({
    browser,
  }) => {
    const ctx = await contextAs(browser, 'ana');
    const page = await ctx.newPage();
    const res = await page.goto('/calendar?view=banana&date=2026-02-30&rooms=nope');
    expect(res?.status()).toBe(200);
    await expect(page.getByTestId('view-week')).toHaveAttribute('aria-pressed', 'true');
    await ctx.close();
  });
});
