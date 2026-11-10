import { expect, test } from '@playwright/test';
import {
  apiAs,
  contextAs,
  createTracker,
  getRooms,
  kyivInstant,
  sweepWeek,
  type Room,
} from '../helpers/api';
import { openCalendar, type View } from '../helpers/ui';

// A fixed week, so the pictures are identical on every run (Monday 2029-09-03, nothing else there).
const MONDAY = '2029-09-03';
const day = (n: number) => {
  const d = new Date(Date.UTC(2029, 8, 3 + n));
  return d.toISOString().slice(0, 10);
};
const FROM = '2029-08-25T00:00:00Z';
const TO = '2029-10-10T00:00:00Z';

test.describe('screenshots of the key views', () => {
  let rooms: Room[];
  let tracker: ReturnType<typeof createTracker>;

  test.beforeAll(async () => {
    const ana = await apiAs('ana');
    rooms = await getRooms(ana);
    await sweepWeek(ana, FROM, TO);
    tracker = createTracker(ana);
    const make = (
      i: number,
      title: string,
      n: number,
      from: string,
      to: string,
      extra: object = {},
    ) =>
      tracker.create({
        roomId: rooms[i]!.id,
        title,
        startAt: kyivInstant(day(n), from),
        endAt: kyivInstant(day(n), to),
        ...extra,
      });
    await make(0, 'E2E Planning', 0, '10:00', '11:00');
    await make(1, 'E2E Design review', 1, '09:30', '11:00');
    await make(2, 'E2E Interviews', 1, '10:00', '12:00');
    await make(3, 'E2E Standup', 1, '10:30', '10:45');
    await make(4, 'E2E Retro', 2, '14:00', '17:00');
    await make(0, 'E2E Weekly sync', 3, '09:00', '10:00', { rrule: 'FREQ=WEEKLY;COUNT=4' });
    await tracker.create({
      roomId: rooms[1]!.id,
      title: 'E2E Office closed',
      startAt: kyivInstant(day(4), '00:00'),
      endAt: kyivInstant(day(5), '00:00'),
      allDay: true,
    });
    for (let i = 0; i < 6; i++)
      await make(
        i % rooms.length,
        `E2E Busy ${i + 1}`,
        8,
        `${8 + i}:00`,
        `${9 + i}:00`.padStart(5, '0'),
      );
  });
  test.afterAll(async () => {
    await tracker.cleanup();
    await sweepWeek(await apiAs('ana'), FROM, TO);
  });

  for (const scheme of ['light', 'dark'] as const) {
    test.describe(`${scheme} theme`, () => {
      test.use({ colorScheme: scheme });

      for (const view of ['day', 'week', 'month', 'list'] as const satisfies View[]) {
        test(`${view} view`, async ({ browser }, info) => {
          const ctx = await contextAs(browser, 'ana', {
            colorScheme: scheme,
            viewport: { width: 1280, height: 800 },
            timezoneId: 'Europe/Kyiv',
            locale: 'en-US',
          });
          const page = await ctx.newPage();
          await openCalendar(page, view, MONDAY);
          // The time grid scrolls to 07:00 on its own; wait for fonts and the data to settle.
          await page.evaluate(() => document.fonts.ready);
          await expect(page.getByTestId('sync-indicator')).toHaveAttribute('data-status', 'saved');
          await expect(page).toHaveScreenshot(`${view}-${scheme}.png`);
          void info;
          await ctx.close();
        });
      }

      test('event panel', async ({ browser }) => {
        const ctx = await contextAs(browser, 'ana', {
          colorScheme: scheme,
          viewport: { width: 1280, height: 800 },
          timezoneId: 'Europe/Kyiv',
          locale: 'en-US',
        });
        const page = await ctx.newPage();
        await openCalendar(page, 'week', MONDAY);
        await page.getByTestId('new-event').click();
        await expect(page.getByTestId('event-panel')).toBeVisible();
        // The free-room suggestions load a moment after the panel opens: wait for them, not for a timer.
        await expect(page.getByTestId('free-room').first()).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        await expect(page).toHaveScreenshot(`panel-${scheme}.png`);
        await ctx.close();
      });
    });
  }
});
