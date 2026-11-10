import { expect, type Locator, type Page } from '@playwright/test';

export type View = 'day' | 'week' | 'month' | 'list';

export async function openCalendar(
  page: Page,
  view: View,
  date: string,
  rooms: string[] = [],
): Promise<void> {
  const query = new URLSearchParams({
    view,
    date,
    ...(rooms.length ? { rooms: rooms.join(',') } : {}),
  });
  await page.goto(`/calendar?${query}`);
  await page.waitForSelector(
    view === 'month'
      ? '[data-testid=month-grid]'
      : view === 'list'
        ? '[data-testid=list-view]'
        : '[data-testid=time-grid]',
  );
  // Hydration finished once the sync indicator reports a state.
  await expect(page.getByTestId('sync-indicator')).toBeVisible();
}

export const eventBlock = (page: Page, title: string): Locator =>
  page.locator('.event-block[data-key]').filter({ hasText: title }).first();

export async function liveText(page: Page): Promise<string> {
  return ((await page.getByTestId('live-region').textContent()) ?? '').trim();
}

export const syncState = (page: Page) => page.getByTestId('sync-indicator');

/** Presses on the middle of a box, drags by (dx, dy) in small steps, releases. */
export async function dragBy(
  page: Page,
  from: { x: number; y: number },
  dx: number,
  dy: number,
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 4 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 6 });
  await page.mouse.up();
}

/** The block's box, after scrolling it into view inside the grid. */
export async function boxOf(
  locator: Locator,
): Promise<{ x: number; y: number; width: number; height: number }> {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error('element has no box');
  return box;
}

/** px per hour of the time grid (see PX_PER_HOUR) and the width of a day column. */
export const PX_PER_HOUR = 48;
export const SLOT_PX = PX_PER_HOUR / 4;
