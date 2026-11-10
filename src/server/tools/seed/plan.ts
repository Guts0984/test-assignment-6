import { Temporal } from '@js-temporal/polyfill';
import { fromWallClock, toRange, type RecurringSource } from '@/shared/time';
import { isOpenEnded, occurrencesOf } from '@/server/modules/events';
import { DAYS, FLOORS, ROOM_COUNT, SEED_USERS, TARGET_OCCURRENCES, TITLES } from './data';
import { createRand, type Rand } from './prng';

export type PlannedUser = {
  id: string;
  email: string;
  name: string;
  timezone: string;
  locale: string;
};
export type PlannedRoom = { id: string; name: string; floor: number; capacity: number };
export type PlannedEvent = RecurringSource & {
  id: string;
  roomId: string;
  creatorId: string;
  title: string;
  description: string;
  seriesId: string | null;
  originalStart: string | null;
  materializedUntil: string | null;
  attendeeIds: string[];
  /** `event_occurrences.during` values */
  ranges: string[];
};
export type Plan = {
  users: PlannedUser[];
  rooms: PlannedRoom[];
  events: PlannedEvent[];
  windowStart: Temporal.Instant;
  windowEnd: Temporal.Instant;
  /** Occurrences starting inside [windowStart, windowEnd). */
  occurrencesInWindow: number;
};

type Draft = Omit<PlannedEvent, 'ranges' | 'materializedUntil' | 'attendeeIds'> & {
  /** For infinite series: materialize up to here. */
  horizon?: Temporal.Instant;
};

const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;

const at = (date: string, time: string, tzid: string): string =>
  fromWallClock(Temporal.PlainDateTime.from(`${date}T${time}`), tzid).toString();

const mins = (start: string, minutes: number): string =>
  Temporal.Instant.from(start).add({ minutes }).toString();

type Transition = { date: string; gap: boolean };

/**
 * The next `count` clock changes of `tzid` after `from`, from the time zone database. `gap` = clocks
 * jump forward (a local time does not exist), otherwise they fall back (a local time happens twice).
 */
function nextTransitions(tzid: string, from: Temporal.Instant, count: number): Transition[] {
  const out: Transition[] = [];
  let zoned = from.toZonedDateTimeISO(tzid);
  for (let i = 0; i < count; i += 1) {
    const next = zoned.getTimeZoneTransition('next');
    if (!next) break;
    out.push({
      date: next.toPlainDate().toString(),
      gap: next.offsetNanoseconds > zoned.offsetNanoseconds,
    });
    zoned = next;
  }
  return out;
}

/**
 * Deterministic seed plan for a given `now`: 3 users, 50 rooms and exactly
 * TARGET_OCCURRENCES occurrences inside the next two months (recurring series count by
 * occurrence), plus fixtures placed on the NEXT real DST transitions of Kyiv and New York after `now`, so whenever the
 * seed runs there are meetings sitting exactly on a clock change.
 * Pure: no I/O. No two occurrences overlap in one room (the DB would reject them).
 */
export function buildPlan(now: Temporal.Instant): Plan {
  const windowStart = now.round({ smallestUnit: 'hour', roundingMode: 'floor' });
  const windowEnd = windowStart.toZonedDateTimeISO('UTC').add({ months: 2 }).toInstant();
  const rand: Rand = createRand(Math.floor(windowStart.epochMilliseconds / 86_400_000));

  const users: PlannedUser[] = SEED_USERS.map((u) => ({ id: rand.uuid(), ...u }));
  const rooms: PlannedRoom[] = Array.from({ length: ROOM_COUNT }, (_, i) => ({
    id: rand.uuid(),
    name: `Room ${(i % FLOORS) + 1}${String(Math.floor(i / FLOORS) + 1).padStart(2, '0')}`,
    floor: (i % FLOORS) + 1,
    capacity: rand.pick([4, 6, 8, 10, 12, 20] as const),
  }));
  const [ana, bob, kenji] = users as [PlannedUser, PlannedUser, PlannedUser];
  const room = (i: number): string => (rooms[i] as PlannedRoom).id;

  const booked = new Map<string, { s: number; e: number }[]>();
  const events: PlannedEvent[] = [];
  let inWindow = 0;

  const isStartInWindow = (start: Temporal.Instant) =>
    Temporal.Instant.compare(start, windowStart) >= 0 &&
    Temporal.Instant.compare(start, windowEnd) < 0;

  /** Adds the event if it fits (no room overlap, stays within the target). */
  const tryAdd = (d: Draft, opts: { force?: boolean } = {}): boolean => {
    const occ = occurrencesOf(d, d.horizon ?? windowEnd);
    if (occ.length === 0) return false;
    const list = booked.get(d.roomId) ?? [];
    const clash = occ.some((o) =>
      list.some((b) => o.start.epochMilliseconds < b.e && o.end.epochMilliseconds > b.s),
    );
    if (clash) return false;
    const add = occ.filter((o) => isStartInWindow(o.start)).length;
    if (!opts.force && inWindow + add > TARGET_OCCURRENCES) return false;

    booked.set(d.roomId, [
      ...list,
      ...occ.map((o) => ({ s: o.start.epochMilliseconds, e: o.end.epochMilliseconds })),
    ]);
    inWindow += add;
    const others = users.filter((u) => u.id !== d.creatorId && rand.chance(0.5));
    events.push({
      ...d,
      // Only open-ended series carry a materialization horizon.
      materializedUntil: isOpenEnded(d) ? (d.horizon ?? windowEnd).toString() : null,
      attendeeIds: others.map((u) => u.id),
      ranges: occ.map((o) => toRange(o.start, o.end)),
    });
    return true;
  };

  const base = (
    over: Partial<Draft> &
      Pick<Draft, 'roomId' | 'creatorId' | 'title' | 'startAt' | 'endAt' | 'tzid'>,
  ): Draft => ({
    id: rand.uuid(),
    description: '',
    allDay: false,
    rrule: null,
    exdates: [],
    seriesId: null,
    originalStart: null,
    ...over,
  });

  const mustAdd = (d: Draft) => {
    if (!tryAdd(d, { force: true })) throw new Error(`seed fixture does not fit: ${d.title}`);
  };

  // Series that started in the past run on for another 14 months, whenever the seed is run.
  const until = `${windowStart.toZonedDateTimeISO('UTC').add({ months: 14 }).toPlainDate().toString().replaceAll('-', '')}T235959Z`;

  // ---- Fixtures: the next DST transitions of Kyiv and New York (placed from the zone database) ----
  const planning = base({
    roomId: room(0),
    creatorId: ana.id,
    title: 'Weekly planning',
    tzid: 'Europe/Kyiv',
    startAt: at('2026-03-02', '09:00', 'Europe/Kyiv'),
    endAt: at('2026-03-02', '10:00', 'Europe/Kyiv'),
    rrule: `FREQ=WEEKLY;BYDAY=MO;UNTIL=${until}`,
  });
  // One occurrence in the window is edited "only this": exdate + a detached event.
  const upcoming = occurrencesOf(planning, windowEnd).filter((o) => isStartInWindow(o.start));
  const moved = upcoming[1];
  if (moved) planning.exdates = [moved.start.toString()];
  mustAdd(planning);
  if (moved) {
    const day = moved.start.toZonedDateTimeISO('Europe/Kyiv').toPlainDate().toString();
    mustAdd(
      base({
        roomId: room(1),
        creatorId: ana.id,
        title: 'Weekly planning (moved)',
        tzid: 'Europe/Kyiv',
        startAt: at(day, '11:00', 'Europe/Kyiv'),
        endAt: at(day, '12:00', 'Europe/Kyiv'),
        seriesId: planning.id,
        originalStart: moved.start.toString(),
      }),
    );
  }
  mustAdd(
    base({
      roomId: room(2),
      creatorId: bob.id,
      title: 'Daily standup (NY)',
      tzid: 'America/New_York',
      startAt: at('2026-03-02', '08:30', 'America/New_York'),
      endAt: at('2026-03-02', '09:00', 'America/New_York'),
      rrule: `FREQ=DAILY;BYDAY=${DAYS.join(',')};UNTIL=${until}`,
    }),
  );
  for (const t of nextTransitions('Europe/Kyiv', windowStart, 2)) {
    // A nightly job at 03:30 on the five nights around the change: 03:30 does not exist on the "gap"
    // night and happens twice on the "overlap" night.
    const first = Temporal.PlainDate.from(t.date).subtract({ days: 2 }).toString();
    mustAdd(
      base({
        roomId: room(3),
        creatorId: ana.id,
        title: `Night deploy (${t.gap ? 'gap' : 'overlap'})`,
        tzid: 'Europe/Kyiv',
        startAt: at(first, '03:30', 'Europe/Kyiv'),
        endAt: at(first, '04:30', 'Europe/Kyiv'),
        rrule: 'FREQ=DAILY;COUNT=5',
      }),
    );
  }
  for (const t of nextTransitions('America/New_York', windowStart, 2)) {
    // 02:30 does not exist on the spring night; 01:30 happens twice on the autumn night.
    const time = t.gap ? '02:30' : '01:30';
    mustAdd(
      base({
        roomId: room(4),
        creatorId: bob.id,
        title: t.gap ? 'Spring-forward call' : 'Fall-back call',
        tzid: 'America/New_York',
        startAt: at(t.date, time, 'America/New_York'),
        endAt: mins(at(t.date, time, 'America/New_York'), 60),
      }),
    );
  }
  mustAdd(
    base({
      roomId: room(5),
      creatorId: kenji.id,
      title: 'Monthly review (Tokyo)',
      tzid: 'Asia/Tokyo',
      startAt: at('2026-03-06', '10:00', 'Asia/Tokyo'),
      endAt: at('2026-03-06', '11:00', 'Asia/Tokyo'),
      rrule: `FREQ=MONTHLY;BYDAY=1FR;UNTIL=${until}`,
    }),
  );
  // Open-ended series: materialized one year ahead; stage 4 extends the horizon.
  mustAdd(
    base({
      roomId: room(6),
      creatorId: ana.id,
      title: 'All-hands',
      tzid: 'Europe/Kyiv',
      startAt: at('2026-03-05', '11:00', 'Europe/Kyiv'),
      endAt: at('2026-03-05', '12:00', 'Europe/Kyiv'),
      rrule: 'FREQ=WEEKLY;BYDAY=TH',
      horizon: windowStart.toZonedDateTimeISO('UTC').add({ years: 1 }).toInstant(),
    }),
  );

  // ---- Fixtures relative to now: cross-timezone day, overlaps, all-day ----
  const dayIn = (tz: string, days: number) =>
    windowStart.toZonedDateTimeISO(tz).toPlainDate().add({ days });
  const nyDay = dayIn('America/New_York', 3);
  mustAdd(
    base({
      roomId: room(7),
      creatorId: bob.id,
      title: 'Late call (NY 23:30)',
      tzid: 'America/New_York',
      startAt: at(nyDay.toString(), '23:30', 'America/New_York'),
      endAt: at(nyDay.add({ days: 1 }).toString(), '00:30', 'America/New_York'),
    }),
  );
  const clusterDay = dayIn('Europe/Kyiv', 2).toString();
  const cluster: [string, number][] = [
    ['10:00', 90],
    ['10:15', 60],
    ['10:30', 45],
    ['10:45', 120],
    ['11:00', 30],
  ];
  cluster.forEach(([time, minutes], i) =>
    mustAdd(
      base({
        roomId: room(8 + i),
        creatorId: ana.id,
        title: `Overlap ${i + 1}`,
        tzid: 'Europe/Kyiv',
        startAt: at(clusterDay, time, 'Europe/Kyiv'),
        endAt: mins(at(clusterDay, time, 'Europe/Kyiv'), minutes),
      }),
    ),
  );
  const closed = dayIn('Europe/Kyiv', 6).toString();
  mustAdd(
    base({
      roomId: room(13),
      creatorId: ana.id,
      title: 'Office closed',
      tzid: 'Europe/Kyiv',
      allDay: true,
      startAt: at(closed, '00:00', 'Europe/Kyiv'),
      endAt: at(dayIn('Europe/Kyiv', 7).toString(), '00:00', 'Europe/Kyiv'),
    }),
  );
  mustAdd(
    base({
      roomId: room(14),
      creatorId: kenji.id,
      title: 'Offsite (3 days)',
      tzid: 'Asia/Tokyo',
      allDay: true,
      startAt: at(dayIn('Asia/Tokyo', 10).toString(), '00:00', 'Asia/Tokyo'),
      endAt: at(dayIn('Asia/Tokyo', 13).toString(), '00:00', 'Asia/Tokyo'),
    }),
  );

  // ---- Bulk ----
  const addRandom = (): void => {
    const creator = rand.pick(users);
    const tz = creator.timezone;
    const date = dayIn(tz, rand.int(0, 60));
    const weekend = date.dayOfWeek >= 6;
    if (weekend && rand.chance(0.85)) return;
    const remaining = TARGET_OCCURRENCES - inWindow;
    const roomId = (rand.pick(rooms) as PlannedRoom).id;
    const title = `${rand.pick(TITLES)}`;
    const roll = remaining < 12 ? 1 : rand.next();

    if (roll < 0.07) {
      const days = rand.int(1, 3);
      tryAdd(
        base({
          roomId,
          creatorId: creator.id,
          title,
          tzid: tz,
          allDay: true,
          startAt: at(date.toString(), '00:00', tz),
          endAt: at(date.add({ days }).toString(), '00:00', tz),
        }),
      );
      return;
    }
    const startMin = rand.int(8 * 4, 17 * 4) * 15;
    const time = `${String(Math.floor(startMin / 60)).padStart(2, '0')}:${String(startMin % 60).padStart(2, '0')}`;
    const startAt = at(date.toString(), time, tz);
    const endAt = mins(startAt, rand.pick([30, 45, 60, 60, 90, 120] as const));
    const draft = base({ roomId, creatorId: creator.id, title, tzid: tz, startAt, endAt });

    if (roll < 0.27) {
      const kind = rand.int(0, 3);
      // The first occurrence must itself match the rule, so BYDAY always contains its weekday.
      const own = WEEKDAYS[date.dayOfWeek - 1] as string;
      const picked = WEEKDAYS.filter(
        (d) => d === own || (d !== 'SA' && d !== 'SU' && rand.chance(0.4)),
      );
      const rrule =
        kind === 0
          ? `FREQ=DAILY;COUNT=${rand.int(3, 10)}`
          : kind === 1
            ? `FREQ=WEEKLY;BYDAY=${picked.join(',')};COUNT=${rand.int(4, 12)}`
            : kind === 2
              ? `FREQ=WEEKLY;UNTIL=${date
                  .add({ weeks: rand.int(3, 8) })
                  .toString()
                  .replaceAll('-', '')}T235959Z`
              : `FREQ=MONTHLY;COUNT=${rand.int(2, 3)}`;
      tryAdd({ ...draft, rrule });
      return;
    }
    tryAdd(draft);
  };

  let attempts = 0;
  while (inWindow < TARGET_OCCURRENCES && attempts < 200_000) {
    addRandom();
    attempts += 1;
  }
  if (inWindow !== TARGET_OCCURRENCES) {
    throw new Error(`seed plan reached ${inWindow} occurrences, expected ${TARGET_OCCURRENCES}`);
  }
  return { users, rooms, events, windowStart, windowEnd, occurrencesInWindow: inWindow };
}
