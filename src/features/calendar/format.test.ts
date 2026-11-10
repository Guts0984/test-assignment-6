// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseInstant } from '@/shared/zoned';
import en from '../../../messages/en.json';
import uk from '../../../messages/uk.json';
import { dayHeading, longDate, rangeTitle, roomHue, timeOf, timeRange, type Names } from './format';
import { daysOf } from './domain/range';

const names = (m: typeof en): Names => ({
  weekdayShort: m.weekdays.short,
  weekdayLong: m.weekdays.long,
  monthLong: m.months.long,
  monthShort: m.months.short,
  monthGenitive: m.months.genitive,
  time: m.time,
});
const EN = names(en);
const UK = names(uk as typeof en);
const d = (y: number, m: number, day: number) => ({ y, m, d: day });

describe('headings', () => {
  it('day column heading', () => {
    expect(dayHeading(d(2026, 11, 9), EN)).toEqual({ weekday: 'Mon', day: 9 });
    expect(dayHeading(d(2026, 11, 15), UK)).toEqual({ weekday: 'Нд', day: 15 });
  });

  it('long dates follow each language (uk uses the genitive month)', () => {
    expect(longDate(d(2026, 11, 9), 'en', EN)).toBe('Monday, November 9, 2026');
    expect(longDate(d(2026, 11, 9), 'uk', UK)).toBe('понеділок, 9 листопада 2026');
  });

  it('toolbar titles per view and language', () => {
    const week = daysOf('week', d(2026, 11, 11), 1);
    expect(rangeTitle('week', week, 'en', EN)).toBe('Nov 9 – 15, 2026');
    expect(rangeTitle('week', week, 'uk', UK)).toBe('9 – 15 листопада 2026');
    expect(rangeTitle('day', [d(2026, 11, 9)], 'en', EN)).toBe('Monday, November 9, 2026');
    expect(rangeTitle('month', daysOf('month', d(2026, 11, 10), 1), 'en', EN)).toBe(
      'November 2026',
    );
    expect(rangeTitle('month', daysOf('month', d(2026, 11, 10), 1), 'uk', UK)).toBe(
      'Листопад 2026',
    );
  });

  it('a week across a month and a year boundary names both', () => {
    const w = daysOf('week', d(2026, 12, 30), 1); // Dec 28 .. Jan 3
    expect(rangeTitle('week', w, 'en', EN)).toBe('Dec 28, 2026 – Jan 3, 2027');
    expect(rangeTitle('week', daysOf('week', d(2026, 3, 31), 1), 'uk', UK)).toBe(
      '30 березня – 5 квітня 2026',
    );
  });

  it('a month grid that starts in the previous month is still titled by the month it mostly shows', () => {
    // Feb 2026 Monday-start grid: Jan 26 .. Mar 1, the middle day is in February.
    expect(rangeTitle('month', daysOf('month', d(2026, 2, 15), 1), 'en', EN)).toBe('February 2026');
  });
});

describe('times use the viewer zone and clock style', () => {
  const ms = parseInstant('2026-11-10T13:30:00Z')!;
  it('24h and 12h in different zones', () => {
    expect(timeOf(ms, 'Europe/Kyiv', '24h', EN.time)).toBe('15:30');
    expect(timeOf(ms, 'Europe/Kyiv', '12h', EN.time)).toBe('3:30 PM');
    expect(timeOf(ms, 'Asia/Tokyo', '24h', EN.time)).toBe('22:30');
    expect(timeOf(ms, 'America/New_York', '12h', UK.time)).toBe('8:30 дп');
  });

  it('time range', () => {
    expect(timeRange(ms, ms + 45 * 60_000, 'UTC', '24h', EN.time)).toBe('13:30 – 14:15');
  });
});

describe('roomHue', () => {
  it('is deterministic and within 0..359', () => {
    expect(roomHue('room-a')).toBe(roomHue('room-a'));
    for (let i = 0; i < 200; i += 1) {
      const h = roomHue(`room-${i}`);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(360);
    }
  });

  it('gives 50 rooms visibly different colours (no two within 4 degrees of each other)', () => {
    const hues = Array.from({ length: 50 }, (_, i) =>
      roomHue(`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`),
    ).sort((a, b) => a - b);
    const gaps = hues.slice(1).map((h, i) => h - hues[i]!);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(0);
    expect(new Set(hues).size).toBeGreaterThan(40); // few collisions
  });
});
