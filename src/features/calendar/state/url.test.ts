// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { formatCivil, parseInstant } from '@/shared/zoned';
import { parseLocation, sameLocation, toSearch } from './url';

const NOW = parseInstant('2026-11-10T22:30:00Z')!; // 2026-11-11 00:30 in Kyiv, 2026-11-10 in New York
const ROOM_A = '11111111-1111-4111-8111-111111111111';
const ROOM_B = '22222222-2222-4222-8222-222222222222';
const parse = (q: string, tz = 'Europe/Kyiv') => parseLocation(new URLSearchParams(q), NOW, tz);

describe('parseLocation', () => {
  it('reads view, date and rooms', () => {
    const l = parse(`view=month&date=2026-03-05&rooms=${ROOM_A},${ROOM_B}`);
    expect(l.view).toBe('month');
    expect(formatCivil(l.date)).toBe('2026-03-05');
    expect(l.rooms).toEqual([ROOM_A, ROOM_B]);
  });

  it('defaults to the week view and TODAY IN THE PROFILE ZONE (not UTC, not the browser)', () => {
    expect(formatCivil(parse('').date)).toBe('2026-11-11'); // Kyiv is already on the 11th
    expect(formatCivil(parse('', 'America/New_York').date)).toBe('2026-11-10');
    expect(parse('').view).toBe('week');
    expect(parse('').rooms).toEqual([]);
  });

  it.each(['view=year', 'view=', 'view=WEEK', 'view=week;drop'])(
    'an unknown view (%s) falls back to the default',
    (q) => {
      expect(parse(q).view).toBe('week');
    },
  );

  it.each(['date=2026-02-30', 'date=2026-13-01', 'date=tomorrow', 'date=2026-1-1', 'date='])(
    'an invalid date (%s) falls back to today',
    (q) => expect(formatCivil(parse(q).date)).toBe('2026-11-11'),
  );

  it('drops invalid, duplicate and over-limit room ids, and is case-insensitive', () => {
    expect(parse(`rooms=${ROOM_A},nope,${ROOM_A.toUpperCase()},,${ROOM_B}`).rooms).toEqual([
      ROOM_A,
      ROOM_B,
    ]);
    const many = Array.from(
      { length: 80 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    );
    expect(parse(`rooms=${many.join(',')}`).rooms).toHaveLength(50);
  });

  it('accepts Next.js searchParams objects (arrays take the first value)', () => {
    const l = parseLocation({ view: ['day', 'week'], date: '2026-05-01' }, NOW, 'UTC');
    expect(l.view).toBe('day');
    expect(formatCivil(l.date)).toBe('2026-05-01');
  });
});

describe('toSearch', () => {
  it('round-trips every view and the room filter (back/forward restores the state, #19)', () => {
    for (const view of ['day', 'week', 'month', 'list'] as const) {
      const location = { view, date: { y: 2026, m: 3, d: 29 }, rooms: [ROOM_B, ROOM_A] };
      const again = parse(toSearch(location));
      expect(sameLocation(again, location), view).toBe(true);
    }
  });

  it('always includes view and date, and rooms only when filtered (clean shareable URLs)', () => {
    expect(toSearch({ view: 'day', date: { y: 2026, m: 11, d: 10 }, rooms: [] })).toBe(
      'view=day&date=2026-11-10',
    );
    expect(toSearch({ view: 'day', date: { y: 2026, m: 11, d: 10 }, rooms: [ROOM_A] })).toBe(
      `view=day&date=2026-11-10&rooms=${ROOM_A}`,
    );
  });

  it('sameLocation compares by value, so redundant navigation can be skipped', () => {
    const a = { view: 'week' as const, date: { y: 2026, m: 1, d: 1 }, rooms: [] };
    expect(sameLocation(a, { ...a, date: { ...a.date } })).toBe(true);
    expect(sameLocation(a, { ...a, view: 'day' })).toBe(false);
    expect(sameLocation(a, { ...a, rooms: [ROOM_A] })).toBe(false);
  });
});
