// @vitest-environment node
import { Temporal } from '@js-temporal/polyfill';
import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  civilFromDays,
  compareCivil,
  dayOfWeek,
  daysFromCivil,
  daysInMonth,
  diffDays,
  formatCivil,
  formatInstant,
  formatLocal,
  fromLocal,
  isValidZone,
  offsetAt,
  parseCivil,
  parseInstant,
  parseLocal,
  startOfDay,
  startOfMonth,
  startOfWeek,
  toLocal,
  type Disambiguation,
  type Local,
  type Weekday,
} from './index';

/** Temporal is the ORACLE: a trusted, independent implementation of the same semantics. */
const mulberry32 = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const ZONES = [
  'UTC',
  'Europe/Kyiv',
  'America/New_York',
  'Asia/Tokyo',
  'Asia/Kolkata',
  'Asia/Kathmandu',
  'Australia/Lord_Howe',
  'Australia/Sydney',
  'Pacific/Chatham',
  'America/St_Johns',
  'Europe/London',
  'Africa/Casablanca',
  'America/Sao_Paulo',
  'Asia/Tehran',
  'Pacific/Apia',
  'America/Havana',
  'America/Santiago',
  'Asia/Beirut',
  'Europe/Dublin',
  'Pacific/Kiritimati',
];
const MIN = Date.UTC(1970, 0, 1);
const MAX = Date.UTC(2100, 0, 1);

const oracleOffset = (ms: number, tz: string) =>
  Temporal.Instant.fromEpochMilliseconds(ms).toZonedDateTimeISO(tz).offsetNanoseconds / 1e6;

/** All UTC transition instants of a zone between two years, according to the oracle. */
function transitions(tz: string, fromYear: number, toYear: number): number[] {
  const out: number[] = [];
  let zdt: Temporal.ZonedDateTime | null = Temporal.PlainDate.from({
    year: fromYear,
    month: 1,
    day: 1,
  }).toZonedDateTime(tz);
  const end = Temporal.PlainDate.from({ year: toYear, month: 1, day: 1 }).toZonedDateTime(
    tz,
  ).epochMilliseconds;
  for (;;) {
    zdt = zdt.getTimeZoneTransition('next');
    if (!zdt || zdt.epochMilliseconds >= end) return out;
    out.push(zdt.epochMilliseconds);
  }
}

describe('civil date arithmetic (vs Temporal.PlainDate)', () => {
  const rand = mulberry32(1);
  const dates = Array.from({ length: 20_000 }, () => {
    const p = Temporal.PlainDate.from({ year: 1900, month: 1, day: 1 }).add({
      days: Math.floor(rand() * 110_000),
    });
    return { p, c: { y: p.year, m: p.month, d: p.day } };
  });

  it('daysFromCivil/civilFromDays round-trip and match the epoch day count', () => {
    for (const { p, c } of dates) {
      expect(daysFromCivil(c)).toBe(
        p.since(Temporal.PlainDate.from('1970-01-01'), { largestUnit: 'days' }).days,
      );
      expect(civilFromDays(daysFromCivil(c))).toEqual(c);
    }
  });

  it('dayOfWeek, daysInMonth, addDays, addMonths and diffDays agree with Temporal', () => {
    for (const { p, c } of dates.slice(0, 6000)) {
      expect(dayOfWeek(c)).toBe(p.dayOfWeek);
      expect(daysInMonth(c.y, c.m)).toBe(p.daysInMonth);
      const n = Math.floor(rand() * 800) - 400;
      const plus = p.add({ days: n });
      expect(addDays(c, n)).toEqual({ y: plus.year, m: plus.month, d: plus.day });
      const k = Math.floor(rand() * 60) - 30;
      const pm = p.add({ months: k }); // Temporal clamps the day too
      expect(addMonths(c, k)).toEqual({ y: pm.year, m: pm.month, d: pm.day });
      expect(diffDays(c, addDays(c, n))).toBe(n);
    }
  });

  it('startOfWeek works for every week start and never moves forward or more than 6 days back', () => {
    for (const { c } of dates.slice(0, 3000)) {
      for (const ws of [1, 2, 3, 4, 5, 6, 7] as Weekday[]) {
        const s = startOfWeek(c, ws);
        expect(dayOfWeek(s)).toBe(ws);
        const back = diffDays(s, c);
        expect(back).toBeGreaterThanOrEqual(0);
        expect(back).toBeLessThanOrEqual(6);
      }
    }
  });

  it('month arithmetic clamps like calendars do (Jan 31 + 1 month, leap years)', () => {
    expect(addMonths({ y: 2026, m: 1, d: 31 }, 1)).toEqual({ y: 2026, m: 2, d: 28 });
    expect(addMonths({ y: 2028, m: 1, d: 31 }, 1)).toEqual({ y: 2028, m: 2, d: 29 });
    expect(addMonths({ y: 2026, m: 3, d: 31 }, -1)).toEqual({ y: 2026, m: 2, d: 28 });
    expect(addMonths({ y: 2026, m: 11, d: 15 }, 3)).toEqual({ y: 2027, m: 2, d: 15 });
    expect(addMonths({ y: 2026, m: 1, d: 15 }, -2)).toEqual({ y: 2025, m: 11, d: 15 });
    expect(daysInMonth(1900, 2)).toBe(28); // century, not leap
    expect(daysInMonth(2000, 2)).toBe(29); // divisible by 400
  });

  it('parseCivil accepts only real YYYY-MM-DD dates', () => {
    expect(parseCivil('2026-11-10')).toEqual({ y: 2026, m: 11, d: 10 });
    expect(formatCivil({ y: 5, m: 1, d: 2 })).toBe('0005-01-02');
    for (const bad of [
      '2026-02-29',
      '2026-13-01',
      '2026-00-10',
      '2026-1-1',
      '2026-11-10T00:00',
      '',
      '20261110',
      ' 2026-11-10',
      '2026-02-30',
    ]) {
      expect(parseCivil(bad), bad).toBeNull();
    }
    expect(parseCivil('2028-02-29')).not.toBeNull();
    expect(compareCivil({ y: 2026, m: 1, d: 1 }, { y: 2025, m: 12, d: 31 })).toBeGreaterThan(0);
    expect(startOfMonth({ y: 2026, m: 5, d: 20 })).toEqual({ y: 2026, m: 5, d: 1 });
  });
});

describe.each(ZONES)('zone engine vs Temporal: %s', (tz) => {
  it('is a valid zone', () => expect(isValidZone(tz)).toBe(true));

  it('offsetAt and toLocal match for 1500 random instants (1970-2100)', () => {
    const rand = mulberry32(tz.length * 7919);
    for (let i = 0; i < 1500; i += 1) {
      const ms = Math.floor(MIN + rand() * (MAX - MIN));
      expect(offsetAt(ms, tz), `${ms}`).toBe(oracleOffset(ms, tz));
      const z = Temporal.Instant.fromEpochMilliseconds(ms).toZonedDateTimeISO(tz);
      expect(toLocal(ms, tz)).toEqual({
        y: z.year,
        m: z.month,
        d: z.day,
        h: z.hour,
        mi: z.minute,
        s: z.second,
      });
    }
  });

  it('is exact at every transition (1990-2040): 1ms before, at, and 1ms after', () => {
    const ts = transitions(tz, 1990, 2040);
    for (const t of ts) {
      for (const d of [-60_000, -1, 0, 1, 60_000]) {
        expect(offsetAt(t + d, tz), `${tz} @ ${t}${d >= 0 ? '+' : ''}${d}`).toBe(
          oracleOffset(t + d, tz),
        );
      }
    }
  });

  it('fromLocal matches Temporal for every disambiguation, densely around transitions', () => {
    const ts = transitions(tz, 1995, 2035);
    const modes: Disambiguation[] = ['compatible', 'earlier', 'later', 'reject'];
    const locals: Local[] = [];
    for (const t of ts) {
      const before = oracleOffset(t - 1, tz);
      for (let step = -8; step <= 8; step += 1) {
        const p = Temporal.Instant.fromEpochMilliseconds(
          t + before + step * 15 * 60_000 - ((t + before) % 60_000),
        ).toZonedDateTimeISO('UTC');
        locals.push({ y: p.year, m: p.month, d: p.day, h: p.hour, mi: p.minute, s: 0 });
      }
    }
    const rand = mulberry32(tz.length * 31);
    for (let i = 0; i < 400; i += 1) {
      const p = Temporal.Instant.fromEpochMilliseconds(
        Math.floor(MIN + rand() * (MAX - MIN)),
      ).toZonedDateTimeISO('UTC');
      locals.push({ y: p.year, m: p.month, d: p.day, h: p.hour, mi: p.minute, s: p.second });
    }
    let gaps = 0;
    let overlaps = 0;
    for (const l of locals) {
      const plain = Temporal.PlainDateTime.from({
        year: l.y,
        month: l.m,
        day: l.d,
        hour: l.h,
        minute: l.mi,
        second: l.s,
      });
      for (const mode of modes) {
        let expected: number | 'throws';
        try {
          expected = plain.toZonedDateTime(tz, { disambiguation: mode }).epochMilliseconds;
        } catch {
          expected = 'throws';
        }
        if (mode === 'reject' && expected === 'throws') {
          expect(() => fromLocal(l, tz, 'reject'), formatLocal(l)).toThrow(RangeError);
          continue;
        }
        expect(fromLocal(l, tz, mode), `${tz} ${formatLocal(l)} ${mode}`).toBe(expected);
        if (mode === 'compatible') {
          const back = toLocal(fromLocal(l, tz), tz);
          if (formatLocal(back) !== formatLocal(l)) gaps += 1; // shifted forward: it was in a gap
          if (
            expected !== 'throws' &&
            plain.toZonedDateTime(tz, { disambiguation: 'earlier' }).epochMilliseconds !==
              plain.toZonedDateTime(tz, { disambiguation: 'later' }).epochMilliseconds
          )
            overlaps += 1;
        }
      }
    }
    // The test is only meaningful if it really visited gaps / overlaps in zones that have DST.
    if (ts.length > 10) expect(gaps + overlaps).toBeGreaterThan(20);
  });

  it('round-trips: toLocal(fromLocal(x)) = x for every wall time that exists once', () => {
    const rand = mulberry32(99 + tz.length);
    for (let i = 0; i < 800; i += 1) {
      const ms = Math.floor(MIN + rand() * (MAX - MIN));
      const l = toLocal(ms, tz);
      const back = fromLocal(l, tz, 'earlier');
      expect(toLocal(back, tz)).toEqual(l);
      expect(Math.abs(back - Math.floor(ms / 1000) * 1000)).toBeLessThanOrEqual(7_200_000 * 12); // overlap picks the other twin
    }
  });

  it('startOfDay matches Temporal (including zones whose midnight does not exist)', () => {
    const ts = transitions(tz, 2000, 2030);
    const days = ts.slice(0, 60).map((t) => {
      const p = Temporal.Instant.fromEpochMilliseconds(t).toZonedDateTimeISO(tz).toPlainDate();
      return p;
    });
    const rand = mulberry32(5);
    for (let i = 0; i < 100; i += 1)
      days.push(Temporal.PlainDate.from('2000-01-01').add({ days: Math.floor(rand() * 11000) }));
    for (const p of days) {
      const expected = p.toZonedDateTime(tz).epochMilliseconds;
      expect(startOfDay({ y: p.year, m: p.month, d: p.day }, tz), `${tz} ${p}`).toBe(expected);
    }
  });
});

describe('the acceptance scenarios, through the engine', () => {
  it('Monday 09:00 Kyiv is 07:00Z before and 06:00Z after the 2026-03-29 DST change (#3)', () => {
    const at = (d: number) => fromLocal({ y: 2026, m: 3, d, h: 9, mi: 0, s: 0 }, 'Europe/Kyiv');
    expect(formatInstant(at(23))).toBe('2026-03-23T07:00:00Z');
    expect(formatInstant(at(30))).toBe('2026-03-30T06:00:00Z');
  });

  it('23:30 in New York is the NEXT day in Tokyo (#4)', () => {
    const ny = fromLocal({ y: 2026, m: 11, d: 12, h: 23, mi: 30, s: 0 }, 'America/New_York');
    expect(toLocal(ny, 'America/New_York')).toMatchObject({ d: 12, h: 23, mi: 30 });
    expect(toLocal(ny, 'Asia/Tokyo')).toMatchObject({ m: 11, d: 13, h: 13, mi: 30 });
  });

  it('days are 23 and 25 hours long on DST days, and midnight-to-midnight spans work', () => {
    const len = (d: number) =>
      startOfDay({ y: 2026, m: 3, d: d + 1 }, 'Europe/Kyiv') -
      startOfDay({ y: 2026, m: 3, d }, 'Europe/Kyiv');
    expect(len(28) / 3_600_000).toBe(24);
    expect(len(29) / 3_600_000).toBe(23);
    const fall = (d: number) =>
      startOfDay({ y: 2026, m: 10, d: d + 1 }, 'Europe/Kyiv') -
      startOfDay({ y: 2026, m: 10, d }, 'Europe/Kyiv');
    expect(fall(25) / 3_600_000).toBe(25);
  });

  it('rejects zones that are not IANA names (offsets, garbage)', () => {
    for (const bad of ['+02:00', 'Mars/Phobos', '', 'Europe/', 'EST5EDT; drop'])
      expect(isValidZone(bad), bad).toBe(false);
  });
});

describe('ISO instants (vs Temporal.Instant)', () => {
  const rand = mulberry32(3);

  it('formatInstant prints exactly what Temporal prints, for whole and fractional milliseconds', () => {
    for (let i = 0; i < 5000; i += 1) {
      const ms = Math.floor((rand() - 0.5) * 8e12) + (i % 3 === 0 ? 0 : Math.floor(rand() * 1000));
      expect(formatInstant(ms)).toBe(Temporal.Instant.fromEpochMilliseconds(ms).toString());
    }
    expect(formatInstant(Math.floor(MIN + 1))).toBe('1970-01-01T00:00:00.001Z');
    expect(formatInstant(1500)).toBe('1970-01-01T00:00:01.5Z');
  });

  it.each([
    '2026-03-30T07:00:00Z',
    '2026-03-30T09:00:00+02:00',
    '2026-03-30T09:00:00+0200',
    '2026-03-30T09:00:00+02',
    '2026-03-30T12:30:00.5+05:30',
    '2026-03-30 07:00:00+00',
    '2026-03-30 07:00:00.123456789+00',
    '2026-03-30T07:00Z',
    '2026-03-29T22:45:00-08:15',
    '1969-12-31T23:59:59.999Z',
  ])('parseInstant(%s) equals Temporal', (text) => {
    expect(parseInstant(text)).toBe(
      Temporal.Instant.from(text.replace(' ', 'T')).epochMilliseconds,
    );
  });

  it.each([
    '',
    '2026-03-30',
    '2026-03-30T07:00:00',
    '2026-03-30T07:00',
    '2026-02-30T10:00:00Z',
    '2026-03-30T24:00:00Z',
    '2026-03-30T10:60:00Z',
    '2026-03-30T10:00:60Z',
    '2026-03-30T10:00:00+25:00',
    'not a date',
    '2026-3-30T10:00:00Z',
    '2026-03-30T10:00:00+02:60',
  ])('parseInstant rejects %j (a wall-clock time is not an instant)', (text) => {
    expect(parseInstant(text)).toBeNull();
  });

  it('parseLocal/formatLocal round-trip and reject impossible values', () => {
    expect(formatLocal(parseLocal('2026-03-29T03:30')!)).toBe('2026-03-29T03:30');
    expect(parseLocal('2026-03-29T03:30:15')?.s).toBe(15);
    for (const bad of [
      '2026-03-29',
      '2026-03-29T24:00',
      '2026-03-29T10:61',
      '2026-02-30T10:00',
      '2026-03-29T10:00Z',
    ]) {
      expect(parseLocal(bad), bad).toBeNull();
    }
  });
});

describe('performance', () => {
  it('converting 2000 events for two zones is cheap once warm (cache works, no per-call Intl parse)', () => {
    const rand = mulberry32(8);
    const instants = Array.from({ length: 2000 }, () =>
      Math.floor(1_780_000_000_000 + rand() * 5_000_000_000),
    );
    for (const ms of instants) toLocal(ms, 'Europe/Kyiv'); // warm
    const t0 = performance.now();
    for (let round = 0; round < 10; round += 1)
      for (const ms of instants) toLocal(ms, 'Europe/Kyiv');
    expect((performance.now() - t0) / 10).toBeLessThan(40); // ms per 2000 conversions
  });
});
