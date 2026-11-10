import { expect, test, type Page } from '@playwright/test';
import {
  apiAs,
  contextAs,
  getRooms,
  kyivInstant,
  sweepWeek,
  weekOf,
  type Room,
} from './helpers/api';
import { boxOf, dragBy, eventBlock, openCalendar, PX_PER_HOUR } from './helpers/ui';

/**
 * Acceptance #13: a week with 2 000 meetings and a day with 50 rooms. Dragging must not stutter and
 * the interaction latency (INP) must stay under 200 ms. Measured in Chromium, which implements the
 * Event Timing API that INP is defined on.
 */
test.skip(
  ({ browserName }) => browserName !== 'chromium',
  'INP is a Chromium (Event Timing) metric',
);
test.setTimeout(300_000);

const INP_BUDGET_MS = 200;
const ROOMS = 50;
const PER_ROOM_PER_DAY = 8; // 13:00..21:00 hourly: 50 rooms × 8 × 5 days = 2 000 events
const FIRST_HOUR = 13; // the mornings stay free (and clear of the seed's Thursday All-hands) as drop targets

async function inPool<T>(items: readonly T[], size: number, work: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (next < items.length) await work(items[next++] as T);
    }),
  );
}

/** Records the slowest interaction (Event Timing) and every animation-frame gap from now on. */
async function startMeasuring(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __m: { inp: number; frames: number[] } };
    w.__m = { inp: 0, frames: [] };
    const options = { type: 'event', durationThreshold: 16 } as PerformanceObserverInit;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.__m.inp = Math.max(w.__m.inp, e.duration);
    }).observe(options);
    let last = performance.now();
    const tick = (now: number) => {
      w.__m.frames.push(now - last);
      last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function readMeasures(page: Page) {
  // Let the last frame and the event-timing entries flush.
  await page.waitForTimeout(300);
  return page.evaluate(() => {
    const m = (window as unknown as { __m: { inp: number; frames: number[] } }).__m;
    const sorted = [...m.frames].sort((a, b) => a - b);
    const p = (q: number) =>
      sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
    return { inp: m.inp, frames: sorted.length, p50: p(0.5), p95: p(0.95), worst: p(1) };
  });
}

test.describe('performance at scale (acceptance #13)', () => {
  let rooms: Room[];
  let week: ReturnType<typeof weekOf>;

  test.beforeAll(async () => {
    week = weekOf(test.info());
    const ana = await apiAs('ana');
    rooms = (await getRooms(ana)).slice(0, ROOMS);
    expect(rooms).toHaveLength(ROOMS);
    await sweepWeek(ana, week.from, week.wideTo);
    const jobs: { room: Room; dayIdx: number; slot: number }[] = [];
    for (const room of rooms)
      for (let dayIdx = 0; dayIdx < 5; dayIdx++)
        for (let slot = 0; slot < PER_ROOM_PER_DAY; slot++) jobs.push({ room, dayIdx, slot });
    await inPool(jobs, 12, async ({ room, dayIdx, slot }) => {
      const res = await ana.post('/api/events', {
        data: {
          roomId: room.id,
          title: `E2E perf ${room.name} ${dayIdx}.${slot}`,
          startAt: kyivInstant(week.day(dayIdx), `${FIRST_HOUR + slot}:00`),
          endAt: kyivInstant(week.day(dayIdx), `${FIRST_HOUR + slot + 1}:00`),
        },
      });
      if (res.status() !== 201) throw new Error(`seed failed: ${res.status()} ${await res.text()}`);
    });
  });

  test.afterAll(async () => {
    const ana = await apiAs('ana');
    const res = await ana.get(
      `/api/events?from=${encodeURIComponent(week.from)}&to=${encodeURIComponent(week.wideTo)}`,
    );
    const { occurrences } = (await res.json()) as {
      occurrences: { eventId: string; version: number; title: string }[];
    };
    await inPool(
      occurrences.filter((o) => o.title.startsWith('E2E perf')),
      12,
      async (o) => {
        await ana.delete(`/api/events/${o.eventId}?version=${o.version}&scope=all`);
      },
    );
  });

  test('a week with 2 000 meetings: all drawn, dragging one stays smooth and INP < 200 ms', async ({
    browser,
  }, info) => {
    const ctx = await contextAs(browser, 'ana');
    const page = await ctx.newPage();
    await openCalendar(page, 'week', week.day(0));
    await expect
      .poll(() => page.locator('.event-block[data-key]', { hasText: 'E2E perf' }).count(), {
        timeout: 60_000,
      })
      .toBe(ROOMS * PER_ROOM_PER_DAY * 5);

    await startMeasuring(page);
    // Grab three meetings in turn and drag each up into the free morning.
    for (let i = 0; i < 3; i++) {
      const target = rooms[10]!.name;
      const block = eventBlock(page, `E2E perf ${target} 0.${i}`);
      const box = await boxOf(block);
      await dragBy(page, { x: box.x + box.width / 2, y: box.y + 4 }, 0, -4 * PX_PER_HOUR);
    }
    const m = await readMeasures(page);
    info.annotations.push({ type: 'week-2000', description: JSON.stringify(m) });
    console.log('week with 2000 events:', JSON.stringify(m));
    expect(m.frames).toBeGreaterThan(30);
    expect(m.inp, `INP ${m.inp} ms`).toBeLessThan(INP_BUDGET_MS);
    // "60 fps": the typical frame is one 60 Hz frame. The tail is only checked loosely (<= 4 frames),
    // because a shared 2-core CI runner is slower than the "average machine" of the assignment.
    expect(m.p50, `median frame ${m.p50} ms`).toBeLessThan(20);
    expect(m.p95, `p95 frame ${m.p95} ms`).toBeLessThanOrEqual(67);
    await ctx.close();
  });

  test('a day with 50 rooms: all columns drawn, dragging stays smooth and INP < 200 ms', async ({
    browser,
  }, info) => {
    const ctx = await contextAs(browser, 'ana');
    const page = await ctx.newPage();
    await openCalendar(
      page,
      'day',
      week.day(1),
      rooms.map((r) => r.id),
    );
    await expect(page.locator('[data-column-id]')).toHaveCount(ROOMS);

    await startMeasuring(page);
    const block = eventBlock(page, `E2E perf ${rooms[3]!.name} 1.2`);
    const box = await boxOf(block);
    await dragBy(page, { x: box.x + box.width / 2, y: box.y + 8 }, 4 * 132, -3 * PX_PER_HOUR);
    const m = await readMeasures(page);
    info.annotations.push({ type: 'day-50-rooms', description: JSON.stringify(m) });
    console.log('day with 50 rooms:', JSON.stringify(m));
    expect(m.frames).toBeGreaterThan(30);
    expect(m.inp, `INP ${m.inp} ms`).toBeLessThan(INP_BUDGET_MS);
    // "60 fps": the typical frame is one 60 Hz frame. The tail is only checked loosely (<= 4 frames),
    // because a shared 2-core CI runner is slower than the "average machine" of the assignment.
    expect(m.p50, `median frame ${m.p50} ms`).toBeLessThan(20);
    expect(m.p95, `p95 frame ${m.p95} ms`).toBeLessThanOrEqual(67);
    await ctx.close();
  });
});
