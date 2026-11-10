import type { CreateEventBody } from '@/shared/contracts';
import {
  addDays,
  dayOfWeek,
  formatCivil,
  formatInstant,
  fromLocal,
  parseCivil,
  parseClock,
  parseInstant,
  startOfDay,
  toLocal,
  type Civil,
  type TimeLabels,
} from '@/shared/zoned';

export type RepeatKind = 'none' | 'daily' | 'weekly' | 'monthly';
export type RepeatEnd =
  { kind: 'never' } | { kind: 'until'; until: string } | { kind: 'count'; count: number };
export const WEEKDAY_CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
export type WeekdayCode = (typeof WEEKDAY_CODES)[number];

export type Repeat = {
  kind: RepeatKind;
  interval: number;
  weekdays: WeekdayCode[];
  end: RepeatEnd;
};

/** What the form edits. Dates are `YYYY-MM-DD`, times are what the person typed ("9:30", "2:30 PM"). */
export type FormValues = {
  title: string;
  roomId: string;
  startDate: string;
  startTime: string;
  /** For all-day events this is the LAST day (inclusive), as people think of it. */
  endDate: string;
  endTime: string;
  allDay: boolean;
  repeat: Repeat;
  attendeeIds: string[];
  description: string;
};

export type FieldError =
  | 'titleRequired'
  | 'titleTooLong'
  | 'roomRequired'
  | 'invalidDate'
  | 'invalidTime'
  | 'endBeforeStart'
  | 'intervalRange'
  | 'countRange'
  | 'untilInvalid'
  | 'untilBeforeStart'
  | 'weekdaysRequired';

export type Errors = Partial<
  Record<
    'title' | 'roomId' | 'startDate' | 'startTime' | 'endDate' | 'endTime' | 'repeat',
    FieldError
  >
>;

export const noRepeat: Repeat = { kind: 'none', interval: 1, weekdays: [], end: { kind: 'never' } };
export const MAX_COUNT = 1000;

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
/** The weekday of a `YYYY-MM-DD` start date typed in the form; a weekly rule always includes it. */
export function startWeekday(startDate: string): WeekdayCode | undefined {
  const day = parseCivil(startDate);
  return day ? weekdayOf(day) : undefined;
}

const weekdayOf = (c: Civil): WeekdayCode => WEEKDAY_CODES[dayOfWeek(c) - 1] as WeekdayCode;

/**
 * The RRULE for a repeat setting. The rule must contain the event's own start (the server insists the
 * first occurrence is the start), so a weekly rule always includes the start's weekday. UNTIL is the end
 * of that day on the wall clock of the event's zone.
 */
export function buildRrule(repeat: Repeat, start: Civil): string | null {
  if (repeat.kind === 'none') return null;
  const parts = [`FREQ=${repeat.kind.toUpperCase()}`];
  if (repeat.interval > 1) parts.push(`INTERVAL=${repeat.interval}`);
  if (repeat.kind === 'weekly') {
    const days = new Set<WeekdayCode>([...repeat.weekdays, weekdayOf(start)]);
    parts.push(`BYDAY=${WEEKDAY_CODES.filter((d) => days.has(d)).join(',')}`);
  }
  if (repeat.kind === 'monthly') parts.push(`BYMONTHDAY=${start.d}`);
  if (repeat.end.kind === 'count') parts.push(`COUNT=${repeat.end.count}`);
  if (repeat.end.kind === 'until') {
    const u = parseCivil(repeat.end.until);
    if (u) parts.push(`UNTIL=${pad(u.y, 4)}${pad(u.m)}${pad(u.d)}T235959Z`);
  }
  return parts.join(';');
}

/** Reads back a rule written by `buildRrule`. Rules from elsewhere that we cannot express return null. */
export function parseRrule(rrule: string | null): Repeat | null {
  if (!rrule) return noRepeat;
  const map = new Map(rrule.split(';').map((p) => p.split('=') as [string, string]));
  const kind = ({ DAILY: 'daily', WEEKLY: 'weekly', MONTHLY: 'monthly' } as const)[
    map.get('FREQ') as 'DAILY'
  ];
  const known = new Set(['FREQ', 'INTERVAL', 'BYDAY', 'BYMONTHDAY', 'COUNT', 'UNTIL']);
  if (!kind || [...map.keys()].some((k) => !known.has(k))) return null;
  const until = map.get('UNTIL');
  const count = map.get('COUNT');
  const m = until ? /^(\d{4})(\d{2})(\d{2})T/.exec(until) : null;
  return {
    kind,
    interval: Number(map.get('INTERVAL') ?? 1),
    weekdays: (map.get('BYDAY')?.split(',') ?? []).filter((d): d is WeekdayCode =>
      (WEEKDAY_CODES as readonly string[]).includes(d),
    ),
    end: m
      ? { kind: 'until', until: `${m[1]}-${m[2]}-${m[3]}` }
      : count
        ? { kind: 'count', count: Number(count) }
        : { kind: 'never' },
  };
}

export type BuildContext = { tz: string; labels: TimeLabels };
export type BuildResult =
  | { ok: true; body: Omit<CreateEventBody, 'id'> & { tzid: string } }
  | { ok: false; errors: Errors };

/** Validates the form and turns it into the API body. Never throws: bad input becomes `errors`. */
export function buildBody(v: FormValues, { tz, labels }: BuildContext): BuildResult {
  const errors: Errors = {};
  const title = v.title.trim();
  if (!title) errors.title = 'titleRequired';
  else if (title.length > 200) errors.title = 'titleTooLong';
  if (!v.roomId) errors.roomId = 'roomRequired';

  const startDay = parseCivil(v.startDate);
  const endDay = parseCivil(v.endDate);
  if (!startDay) errors.startDate = 'invalidDate';
  if (!endDay) errors.endDate = 'invalidDate';

  // Times are checked on their own, so every problem is reported at once.
  const sm = v.allDay ? 0 : parseClock(v.startTime, labels);
  const em = v.allDay ? 0 : parseClock(v.endTime, labels);
  if (!v.allDay) {
    if (sm === null) errors.startTime = 'invalidTime';
    if (em === null) errors.endTime = 'invalidTime';
  }

  let start = NaN;
  let end = NaN;
  if (startDay && endDay && sm !== null && em !== null) {
    if (v.allDay) {
      start = startOfDay(startDay, tz);
      end = startOfDay(addDays(endDay, 1), tz); // the last day is inclusive for people, exclusive for the server
      if (end <= start) errors.endDate = 'endBeforeStart';
    } else {
      start = fromLocal({ ...startDay, h: Math.floor(sm / 60), mi: sm % 60, s: 0 }, tz);
      end = fromLocal({ ...endDay, h: Math.floor(em / 60), mi: em % 60, s: 0 }, tz);
      // Judged in REAL time: on a spring-forward day "02:30 - 03:30" is zero long (02:30 does not exist).
      if (end <= start) errors.endTime = 'endBeforeStart';
    }
  }

  const r = v.repeat;
  let rrule: string | null = null;
  if (r.kind !== 'none') {
    if (!Number.isInteger(r.interval) || r.interval < 1 || r.interval > 99)
      errors.repeat = 'intervalRange';
    else if (
      r.end.kind === 'count' &&
      (!Number.isInteger(r.end.count) || r.end.count < 1 || r.end.count > MAX_COUNT)
    )
      errors.repeat = 'countRange';
    else if (r.end.kind === 'until') {
      const u = parseCivil(r.end.until);
      if (!u) errors.repeat = 'untilInvalid';
      else if (startDay && formatCivil(u) < formatCivil(startDay))
        errors.repeat = 'untilBeforeStart';
    }
    if (!errors.repeat && startDay) rrule = buildRrule(r, startDay);
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    body: {
      roomId: v.roomId,
      title,
      description: v.description.trim(),
      startAt: formatInstant(start),
      endAt: formatInstant(end),
      allDay: v.allDay,
      tzid: tz,
      rrule,
      attendeeIds: [...new Set(v.attendeeIds)],
    },
  };
}

/** Form values for an existing event (or a new one at a given slot), in the viewer's zone. */
export function valuesFor(
  e: {
    title: string;
    roomId: string;
    start: number;
    end: number;
    allDay: boolean;
    description: string;
    attendeeIds: string[];
    rrule: string | null;
  },
  tz: string,
  eventTz: string,
  formatTime: (minutes: number) => string,
): FormValues {
  // All-day events are dates in the event's own zone, so read them there.
  const zone = e.allDay ? eventTz : tz;
  const s = toLocal(e.start, zone);
  const endLocal = toLocal(e.end, zone);
  // For all-day events the stored end is an exclusive midnight; people think of the last day instead.
  const lastDay = toLocal(e.end - 1, zone);
  return {
    title: e.title,
    roomId: e.roomId,
    allDay: e.allDay,
    description: e.description,
    attendeeIds: [...e.attendeeIds],
    startDate: formatCivil(s),
    startTime: formatTime(s.h * 60 + s.mi),
    endDate: formatCivil(e.allDay ? lastDay : endLocal),
    endTime: formatTime(endLocal.h * 60 + endLocal.mi),
    repeat: parseRrule(e.rrule) ?? noRepeat,
  };
}

/** The time slot a form currently describes (for finding free rooms), or null while it is incomplete or invalid. */
export function slotOf(v: FormValues, ctx: BuildContext): { start: number; end: number } | null {
  const r = buildBody(
    { ...v, title: v.title || 'x', roomId: v.roomId || 'x', repeat: noRepeat },
    ctx,
  );
  return r.ok
    ? { start: parseInstant(r.body.startAt) as number, end: parseInstant(r.body.endAt) as number }
    : null;
}
