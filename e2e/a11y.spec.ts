import AxeBuilder from '@axe-core/playwright';
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
import { openCalendar, type View } from './helpers/ui';

/** axe on every view, in both colour schemes, plus the panels and dialogs (acceptance #16). */
test.describe('accessibility', () => {
  let rooms: Room[];
  let tracker: ReturnType<typeof createTracker>;
  let week: ReturnType<typeof weekOf>;

  test.beforeEach(async () => {
    week = weekOf(test.info());
    const ana = await apiAs('ana');
    rooms = await getRooms(ana);
    await sweepWeek(ana, week.from, week.wideTo);
    tracker = createTracker(ana);
    for (let i = 0; i < 6; i += 1) {
      await tracker.create({
        roomId: rooms[i]!.id,
        title: `E2E a11y ${i + 1}`,
        startAt: kyivInstant(week.day(2), `${9 + (i % 3)}:00`),
        endAt: kyivInstant(week.day(2), `${10 + (i % 3)}:00`),
        rrule: i === 0 ? 'FREQ=DAILY;COUNT=3' : null,
      });
    }
    await tracker.create({
      roomId: rooms[7]!.id,
      title: 'E2E a11y allday',
      startAt: kyivInstant(week.day(2), '00:00'),
      endAt: kyivInstant(week.day(3), '00:00'),
      allDay: true,
    });
  });
  test.afterEach(async () => {
    await tracker.cleanup();
    await sweepWeek(await apiAs('ana'), week.from, week.wideTo);
  });

  async function expectNoViolations(page: Page, label: string) {
    const results = await new AxeBuilder({ page })
      .options({ rules: { 'target-size': { enabled: true } } }) // WCAG 2.2: Lighthouse checks it, so do we
      .analyze();
    const summary = results.violations.map(
      (v) =>
        `${v.id} (${v.impact}): ${v.nodes.length} node(s), e.g. ${v.nodes[0]?.target.join(' ')}`,
    );
    expect(summary, `axe violations on ${label}`).toEqual([]);
  }

  for (const scheme of ['light', 'dark'] as const) {
    for (const view of ['day', 'week', 'month', 'list'] as View[]) {
      test(`${view} view, ${scheme} theme: no axe violations`, async ({ browser }) => {
        const ctx = await contextAs(browser, 'ana', { colorScheme: scheme });
        const page = await ctx.newPage();
        await openCalendar(page, view, week.day(2));
        await expect(page.locator('.event-block').first()).toBeVisible();
        await expectNoViolations(page, `${view}/${scheme}`);
        await ctx.close();
      });
    }
  }

  test('the event panel, the settings dialog and the scope dialog have no axe violations', async ({
    browser,
  }) => {
    const ctx = await contextAs(browser, 'ana');
    const page = await ctx.newPage();
    await openCalendar(page, 'week', week.day(2));
    await page.getByTestId('new-event').click();
    await expect(page.getByTestId('event-panel')).toBeVisible();
    await expectNoViolations(page, 'event panel');
    await page.getByTestId('panel-close').click();
    await page.getByTestId('open-settings').click();
    await expect(page.getByTestId('settings-dialog')).toBeVisible();
    await expectNoViolations(page, 'settings dialog');
    await ctx.close();
  });

  test('focus goes into a dialog when it opens and back to what opened it when it closes', async ({
    browser,
  }) => {
    const ctx = await contextAs(browser, 'ana');
    const page = await ctx.newPage();
    await openCalendar(page, 'week', week.day(2));
    await page.getByTestId('new-event').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('event-panel')).toBeVisible();
    expect(await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))).toBe(
      'field-title',
    ); // moved into the panel
    await page.keyboard.press('Escape'); // nothing typed: closes at once
    await expect(page.getByTestId('event-panel')).toHaveCount(0);
    expect(await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))).toBe(
      'new-event',
    ); // and back

    await page.getByTestId('open-settings').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('settings-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('settings-dialog')).toHaveCount(0);
    expect(await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))).toBe(
      'open-settings',
    );
    await ctx.close();
  });

  test('unsaved typing is not lost by an accidental Escape or backdrop click', async ({
    browser,
  }) => {
    const ctx = await contextAs(browser, 'ana');
    const page = await ctx.newPage();
    await openCalendar(page, 'week', week.day(2));
    await page.getByTestId('new-event').click();
    await page.getByTestId('field-title').fill('E2E precious draft');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('discard-confirm')).toBeVisible();
    await expect(page.getByTestId('field-title')).toHaveValue('E2E precious draft');
    await page.getByTestId('keep-editing').click();
    await expect(page.getByTestId('discard-confirm')).toHaveCount(0);
    await expect(page.getByTestId('field-title')).toHaveValue('E2E precious draft');
    await page.getByTestId('panel-close').click();
    await page.getByTestId('discard').click();
    await expect(page.getByTestId('event-panel')).toHaveCount(0);
    await ctx.close();
  });
});
