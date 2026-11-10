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

/** Server data per period: neighbouring weeks are prefetched; changing one meeting reloads nothing. */
test.describe('query keys by period', () => {
  let rooms: Room[];
  let tracker: ReturnType<typeof createTracker>;
  let week: ReturnType<typeof weekOf>;

  test.beforeEach(async () => {
    week = weekOf(test.info());
    const ana = await apiAs('ana');
    await ana.patch('/api/me', { data: { timezone: 'Europe/Kyiv', locale: 'uk' } });
    rooms = await getRooms(ana);
    await sweepWeek(ana, week.from, week.wideTo);
    tracker = createTracker(ana);
  });
  test.afterEach(async () => {
    await tracker.cleanup();
    await sweepWeek(await apiAs('ana'), week.from, week.wideTo);
  });

  const windowOf = (url: string) => {
    const m = /[?&]from=([^&]+)&to=([^&]+)/.exec(url);
    return m ? { from: decodeURIComponent(m[1]!), to: decodeURIComponent(m[2]!) } : null;
  };

  test('the previous and the next week are prefetched while idle, and changing a meeting does not reload any of them', async ({
    browser,
  }) => {
    await tracker.create({
      roomId: rooms[0]!.id,
      title: 'E2E query keys',
      startAt: kyivInstant(week.day(1), '10:00'),
      endAt: kyivInstant(week.day(1), '11:00'),
    });
    const ctx = await contextAs(browser, 'ana');
    const page = await ctx.newPage();
    const loads: { from: string; to: string }[] = [];
    page.on('request', (r) => {
      if (r.method() !== 'GET' || !r.url().includes('/api/events?')) return;
      const w = windowOf(r.url());
      if (w) loads.push(w);
    });
    await openCalendar(page, 'week', week.day(1));
    // Prefetch waits for the browser to be idle: expect three distinct periods (this, previous, next).
    await expect
      .poll(() => new Set(loads.map((w) => w.from)).size, { timeout: 15_000 })
      .toBeGreaterThanOrEqual(3);
    const starts = [...new Set(loads.map((w) => w.from))].sort();
    const spans = starts.map(
      (s) => Date.parse(loads.find((w) => w.from === s)!.to) - Date.parse(s),
    );
    // They line up: previous | this | next, each one the same length.
    expect(new Set(spans).size).toBe(1);
    const [prev, cur, next] = starts as [string, string, string];
    expect(Date.parse(prev) + spans[0]!).toBe(Date.parse(cur));
    expect(Date.parse(cur) + spans[0]!).toBe(Date.parse(next));

    // Now move the meeting: the cache is patched in place, nothing is fetched again.
    const before = loads.length;
    const box = await boxOf(eventBlock(page, 'E2E query keys'));
    await dragBy(page, { x: box.x + 20, y: box.y + 8 }, 0, 2 * PX_PER_HOUR);
    await expect(page.getByTestId('sync-indicator')).toHaveAttribute('data-status', 'saved');
    await page.waitForTimeout(1500); // the echo over SSE arrives in this window
    expect(loads.length).toBe(before);
    await ctx.close();
  });
});
