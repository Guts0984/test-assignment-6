// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { formatInstant, parseInstant } from '@/shared/zoned';
import { clampMinutes, dragRange, minutesToPx, pxToMinutes, snapMinutes } from './grid';
import { instantAt, movedTimes, rangeTimes, resizedTimes, shiftSeriesTimes } from './move';
import { makeEvent } from '@/shared/calendar/test-utils';

const iso = (ms: number) => formatInstant(ms);
const day = (y: number, m: number, d: number) => ({ y, m, d });

describe('snapMinutes / dragRange (15 minute step)', () => {
  it('rounds, floors and ceils to the step', () => {
    expect(snapMinutes(7, 15)).toBe(0);
    expect(snapMinutes(8, 15)).toBe(15);
    expect(snapMinutes(7, 15, 'ceil')).toBe(15);
    expect(snapMinutes(29, 15, 'floor')).toBe(15);
    expect(snapMinutes(30, 15, 'floor')).toBe(30);
    expect(snapMinutes(-1, 15, 'floor')).toBe(-15);
  });

  it('a drag in either direction yields the same ordered range, floored at the start and ceiled at the end', () => {
    expect(dragRange(542, 611)).toEqual({ start: 540, end: 615 });
    expect(dragRange(611, 542)).toEqual({ start: 540, end: 615 });
  });

  it('a click or a tiny drag makes a one-slot event, never an empty one', () => {
    expect(dragRange(540, 540)).toEqual({ start: 540, end: 555 });
    expect(dragRange(541, 543)).toEqual({ start: 540, end: 555 });
    expect(dragRange(550, 551)).toEqual({ start: 540, end: 555 });
  });

  it('stays inside the day, also at the very end', () => {
    expect(dragRange(1430, 1500)).toEqual({ start: 1425, end: 1440 });
    expect(dragRange(1439, 1439)).toEqual({ start: 1425, end: 1440 });
    expect(dragRange(-30, 20)).toEqual({ start: 0, end: 30 });
    expect(clampMinutes(-5)).toBe(0);
    expect(clampMinutes(2000)).toBe(1440);
  });

  it('converts between pixels and minutes both ways', () => {
    expect(minutesToPx(90, 60)).toBe(90);
    expect(pxToMinutes(minutesToPx(37, 48), 48)).toBeCloseTo(37, 9);
  });
});

describe('movedTimes / resizedTimes / rangeTimes', () => {
  it('moves the start to the target wall-clock time and keeps the real duration', () => {
    const e = makeEvent('2026-11-10T08:00:00Z', '2026-11-10T09:30:00Z'); // 90 min
    const t = movedTimes(e, { date: day(2026, 11, 12), minutes: 14 * 60 + 15 }, 'Europe/Kyiv');
    expect(iso(t.start)).toBe('2026-11-12T12:15:00Z'); // 14:15 Kyiv (+2)
    expect(t.end - t.start).toBe(90 * 60_000);
  });

  it('dropping onto a spring-forward gap shifts forward like a calendar does (03:30 does not exist)', () => {
    const e = makeEvent('2026-03-27T08:00:00Z', '2026-03-27T09:00:00Z');
    const t = movedTimes(e, { date: day(2026, 3, 29), minutes: 3 * 60 + 30 }, 'Europe/Kyiv');
    expect(iso(t.start)).toBe('2026-03-29T01:30:00Z'); // = 04:30 +03
    expect(t.end - t.start).toBe(3_600_000);
  });

  it('keeps the duration when moved across the DST change (real time, not wall clock)', () => {
    const e = makeEvent('2026-03-27T08:00:00Z', '2026-03-27T10:00:00Z'); // 2h
    const t = movedTimes(e, { date: day(2026, 3, 29), minutes: 0 }, 'Europe/Kyiv');
    expect((t.end - t.start) / 3_600_000).toBe(2);
  });

  it('moves between days and by the VIEWER zone (Tokyo user drops at 09:00 Tokyo)', () => {
    const e = makeEvent('2026-11-10T08:00:00Z', '2026-11-10T09:00:00Z', {
      tzid: 'America/New_York',
    });
    const t = movedTimes(e, { date: day(2026, 11, 11), minutes: 9 * 60 }, 'Asia/Tokyo');
    expect(iso(t.start)).toBe('2026-11-11T00:00:00Z');
  });

  it('an all-day event keeps its number of days and its zone dates, whatever zone the viewer is in', () => {
    const e = makeEvent('2026-11-09T22:00:00Z', '2026-11-11T22:00:00Z', {
      allDay: true,
      tzid: 'Europe/Kyiv',
    }); // Nov 10-11
    const t = movedTimes(e, { date: day(2026, 11, 20), minutes: 0 }, 'Asia/Tokyo');
    expect(iso(t.start)).toBe('2026-11-19T22:00:00Z'); // Nov 20 00:00 Kyiv
    expect(iso(t.end)).toBe('2026-11-21T22:00:00Z'); // Nov 22 00:00 Kyiv: still 2 days
  });

  it('resizing moves only the end, and never below the minimum length', () => {
    const e = makeEvent('2026-11-10T08:00:00Z', '2026-11-10T09:00:00Z');
    expect(iso(resizedTimes(e, { date: day(2026, 11, 10), minutes: 12 * 60 }, 'UTC').end)).toBe(
      '2026-11-10T12:00:00Z',
    );
    const tiny = resizedTimes(e, { date: day(2026, 11, 10), minutes: 5 * 60 }, 'UTC'); // before the start
    expect(tiny.start).toBe(e.start);
    expect(tiny.end - tiny.start).toBe(15 * 60_000);
  });

  it('a dragged range that ends at 24:00 ends at the next local midnight (also when that day is 23h long)', () => {
    const t = rangeTimes(day(2026, 3, 29), 22 * 60, 1440, 'Europe/Kyiv');
    expect(iso(t.start)).toBe('2026-03-29T19:00:00Z'); // 22:00 +03
    expect(iso(t.end)).toBe('2026-03-29T21:00:00Z'); // 00:00 on the 30th at +03
    expect(instantAt({ date: day(2026, 11, 10), minutes: 570 }, 'UTC')).toBe(
      parseInstant('2026-11-10T09:30:00Z'),
    );
  });
});

describe('shiftSeriesTimes (moving a whole series by dragging one occurrence)', () => {
  const kyiv = 'Europe/Kyiv';
  // Series started Mon 2026-03-02 09:00 Kyiv (07:00Z), 1h. We drag the 2026-04-06 occurrence (09:00 Kyiv, 06:00Z in summer time).
  const master = {
    start: parseInstant('2026-03-02T07:00:00Z')!,
    end: parseInstant('2026-03-02T08:00:00Z')!,
  };
  const occ = parseInstant('2026-04-06T06:00:00Z')!;

  it('shifts by the WALL-CLOCK delta: dragging an occurrence from 09:00 to 10:30 moves the series start to 10:30 Kyiv, whatever the DST offset then', () => {
    const newOcc = parseInstant('2026-04-06T07:30:00Z')!; // 10:30 Kyiv (+03)
    const t = shiftSeriesTimes({
      master,
      oldOccurrenceStart: occ,
      newOccurrenceStart: newOcc,
      tzid: kyiv,
    });
    expect(iso(t.start)).toBe('2026-03-02T08:30:00Z'); // 10:30 Kyiv at +02:00 in March
    expect(t.end - t.start).toBe(3_600_000);
  });

  it('a pure time-of-day change keeps the series on the same day', () => {
    const t = shiftSeriesTimes({
      master,
      oldOccurrenceStart: occ,
      newOccurrenceStart: occ - 3_600_000,
      tzid: kyiv,
    });
    expect(iso(t.start)).toBe('2026-03-02T06:00:00Z'); // 08:00 Kyiv
  });

  it('no movement, no change', () => {
    expect(
      shiftSeriesTimes({ master, oldOccurrenceStart: occ, newOccurrenceStart: occ, tzid: kyiv }),
    ).toEqual(master);
  });

  it('a different day shifts the start by whole days (the server will refuse it if the rule no longer matches)', () => {
    const t = shiftSeriesTimes({
      master,
      oldOccurrenceStart: occ,
      newOccurrenceStart: occ + 86_400_000,
      tzid: kyiv,
    });
    expect(iso(t.start)).toBe('2026-03-03T07:00:00Z');
  });
});
