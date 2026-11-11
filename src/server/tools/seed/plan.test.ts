// @vitest-environment node
import { Temporal } from '@js-temporal/polyfill';
import { describe, expect, it } from 'vitest';
import { parseInstant, wallClock } from '@/shared/time';
import { occurrencesOf } from '@/server/modules/events';
import { TARGET_OCCURRENCES } from './data';
import { buildPlan } from './plan';

const NOW = Temporal.Instant.from('2026-11-10T14:30:00Z');
const plan = buildPlan(NOW);
const byTitle = (t: string) => plan.events.filter((e) => e.title === t);

describe('seed plan', () => {
  it('has 3 users in the three required zones and 50 rooms', () => {
    expect(plan.users.map((u) => u.timezone).sort()).toEqual([
      'America/New_York',
      'Asia/Tokyo',
      'Europe/Kyiv',
    ]);
    expect(plan.rooms).toHaveLength(50);
    expect(new Set(plan.rooms.map((r) => r.name)).size).toBe(50);
  });

  it('has exactly 2000 occurrences starting in the next two months', () => {
    const [from, to] = [plan.windowStart, plan.windowEnd];
    const count = plan.events
      .flatMap((e) =>
        occurrencesOf(e, e.materializedUntil ? parseInstant(e.materializedUntil) : to),
      )
      .filter(
        (o) =>
          Temporal.Instant.compare(o.start, from) >= 0 && Temporal.Instant.compare(o.start, to) < 0,
      ).length;
    expect(count).toBe(TARGET_OCCURRENCES);
    expect(plan.occurrencesInWindow).toBe(TARGET_OCCURRENCES);
    expect(to.toString()).toBe('2027-01-10T14:00:00Z');
  });

  it('is deterministic for the same now and differs for another day', () => {
    expect(buildPlan(NOW)).toEqual(plan);
    expect(buildPlan(NOW.add({ hours: 24 * 5 })).events.map((e) => e.id)).not.toEqual(
      plan.events.map((e) => e.id),
    );
  });

  it('people and rooms keep the same ids on every day (room colours depend on them), meetings do not', () => {
    const other = buildPlan(NOW.add({ hours: 24 * 9 }));
    expect(other.users.map((u) => u.id)).toEqual(plan.users.map((u) => u.id));
    expect(other.rooms).toEqual(plan.rooms);
    expect(other.events.map((e) => e.id)).not.toEqual(plan.events.map((e) => e.id));
  });

  it('never double-books a room (checked independently of the builder)', () => {
    const perRoom = new Map<string, { s: number; e: number; title: string }[]>();
    for (const ev of plan.events) {
      for (const r of ev.ranges) {
        const m = /^\[(.+),(.+)\)$/.exec(r);
        const [s, e] = [
          parseInstant(m![1]!).epochMilliseconds,
          parseInstant(m![2]!).epochMilliseconds,
        ];
        perRoom.set(ev.roomId, [...(perRoom.get(ev.roomId) ?? []), { s, e, title: ev.title }]);
      }
    }
    for (const list of perRoom.values()) {
      const sorted = [...list].sort((a, b) => a.s - b.s);
      sorted.forEach((x, i) => {
        if (i > 0)
          expect(x.s, `${sorted[i - 1]!.title} / ${x.title}`).toBeGreaterThanOrEqual(
            sorted[i - 1]!.e,
          );
      });
    }
  });

  it('every recurring event starts on a real occurrence of its own rule', () => {
    for (const ev of plan.events.filter((e) => e.rrule && !e.exdates.length)) {
      const first = occurrencesOf(ev, plan.windowEnd)[0];
      expect(first?.start.toString(), ev.title).toBe(parseInstant(ev.startAt).toString());
    }
  });

  it('is robust: builds exactly 2000 for any day, incl. around DST changes and month ends', () => {
    for (const d of [
      '2026-03-20T10:00:00Z',
      '2026-10-20T08:15:00Z',
      '2027-01-31T23:59:00Z',
      '2026-02-28T00:00:00Z',
    ]) {
      expect(buildPlan(Temporal.Instant.from(d)).occurrencesInWindow, d).toBe(TARGET_OCCURRENCES);
    }
  });

  it('puts meetings on the NEXT real clock changes whenever the seed runs (not on fixed old dates)', () => {
    const offsetOn = (date: string, tz: string) =>
      Temporal.PlainDateTime.from(`${date}T12:00`).toZonedDateTime(tz).offsetNanoseconds;
    // A day has a clock change if the offset differs between the noon before and the noon after it.
    const hasChange = (instant: string, tz: string) => {
      const day = Temporal.Instant.from(instant).toZonedDateTimeISO(tz).toPlainDate();
      return (
        offsetOn(day.subtract({ days: 1 }).toString(), tz) !==
        offsetOn(day.add({ days: 1 }).toString(), tz)
      );
    };
    const nowValues = [
      '2026-11-10T14:30:00Z',
      '2027-01-20T09:00:00Z',
      '2027-03-05T00:00:00Z',
      '2027-08-15T12:00:00Z',
    ];
    for (const iso of nowValues) {
      const now = Temporal.Instant.from(iso);
      const p = buildPlan(now);
      const named = (t: string) => p.events.filter((e) => e.title === t);
      for (const title of ['Spring-forward call', 'Fall-back call']) {
        const [ev] = named(title);
        expect(ev, `${title} at ${iso}`).toBeDefined();
        expect(hasChange(ev!.startAt, 'America/New_York'), `${title} at ${iso}`).toBe(true);
        expect(
          Temporal.Instant.compare(parseInstant(ev!.startAt), now),
          `${title} is ahead of now`,
        ).toBeGreaterThan(0);
      }
      for (const title of ['Night deploy (gap)', 'Night deploy (overlap)']) {
        const [ev] = named(title);
        expect(ev, `${title} at ${iso}`).toBeDefined();
        const nights = occurrencesOf(ev!, p.windowEnd.add({ hours: 24 * 400 })).map((o) =>
          o.start.toString(),
        );
        expect(
          nights.some((n) => hasChange(n, 'Europe/Kyiv')),
          `${title} spans a clock change at ${iso}`,
        ).toBe(true);
      }
    }
  });

  it('contains every kind of event the assignment mentions', () => {
    expect(plan.events.some((e) => e.rrule)).toBe(true);
    expect(plan.events.some((e) => e.allDay && e.ranges.length === 1)).toBe(true);
    const offsite = byTitle('Offsite (3 days)')[0]!;
    const [a, b] = [parseInstant(offsite.startAt), parseInstant(offsite.endAt)];
    expect(
      wallClock(a, 'Asia/Tokyo').toPlainDate().until(wallClock(b, 'Asia/Tokyo').toPlainDate()).days,
    ).toBe(3);
    expect(plan.events.some((e) => e.seriesId && e.originalStart)).toBe(true);
    expect(plan.events.some((e) => e.materializedUntil !== null)).toBe(true);
  });

  it('series exception points to an existing master and that occurrence is excluded', () => {
    const ex = plan.events.find((e) => e.seriesId)!;
    const master = plan.events.find((e) => e.id === ex.seriesId)!;
    expect(master.exdates).toEqual([ex.originalStart]);
    const idxMaster = plan.events.indexOf(master);
    expect(idxMaster).toBeLessThan(plan.events.indexOf(ex));
  });

  it('Kyiv weekly planning is 09:00 Kyiv on every occurrence across DST (acceptance #3)', () => {
    const master = byTitle('Weekly planning')[0]!;
    const occ = occurrencesOf(master, plan.windowEnd);
    expect(occ.length).toBeGreaterThan(50);
    for (const o of occ) {
      expect(o.start.toZonedDateTimeISO('Europe/Kyiv').toPlainTime().toString()).toBe('09:00:00');
    }
    const offsets = new Set(occ.map((o) => o.start.toZonedDateTimeISO('Europe/Kyiv').offset));
    expect(offsets).toEqual(new Set(['+02:00', '+03:00']));
  });

  it('NY 23:30 call falls on the next day for the Tokyo user (acceptance #4)', () => {
    const late = byTitle('Late call (NY 23:30)')[0]!;
    const start = parseInstant(late.startAt);
    const ny = wallClock(start, 'America/New_York');
    const tokyo = wallClock(start, 'Asia/Tokyo');
    expect(ny.toPlainTime().toString()).toBe('23:30:00');
    expect(tokyo.toPlainDate().since(ny.toPlainDate()).days).toBe(1);
  });

  it('has 5 events overlapping in time in different rooms (acceptance #6)', () => {
    const o = ['Overlap 1', 'Overlap 2', 'Overlap 3', 'Overlap 4', 'Overlap 5'].map(
      (t) => byTitle(t)[0]!,
    );
    expect(new Set(o.map((e) => e.roomId)).size).toBe(5);
    const latestStart = Math.max(...o.map((e) => parseInstant(e.startAt).epochMilliseconds));
    const earliestEnd = Math.min(...o.map((e) => parseInstant(e.endAt).epochMilliseconds));
    expect(latestStart).toBeLessThan(earliestEnd);
  });

  it("creators always exist and events use their creator's time zone", () => {
    const tz = new Map(plan.users.map((u) => [u.id, u.timezone]));
    for (const e of plan.events) expect(e.tzid, e.title).toBe(tz.get(e.creatorId));
  });

  it('ids are unique', () => {
    const ids = plan.events.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
