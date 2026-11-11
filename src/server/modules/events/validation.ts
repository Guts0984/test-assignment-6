import { Temporal } from '@js-temporal/polyfill';
import { RRule } from 'rrule';
import { z } from 'zod';
import {
  expandAll,
  isFiniteRule,
  isValidTimeZone,
  parseInstant,
  startMatchesRule,
  wallClock,
  type RecurringSource,
} from '@/shared/time';

export const MAX_FINITE_OCCURRENCES = 1000;
export const MAX_LIST_DAYS = 124;
export const MAX_ATTENDEES = 50;

/**
 * ISO 8601 instant WITH an offset or Z; normalized to UTC `...Z`.
 * One transform (not refine + transform): zod keeps running transforms after a failed refine.
 */
const MIN_INSTANT = Temporal.Instant.from('1970-01-01T00:00:00Z');
const MAX_INSTANT = Temporal.Instant.from('2200-01-01T00:00:00Z');

const instant = z.string().transform((s, ctx) => {
  try {
    const value = Temporal.Instant.from(s);
    // Temporal accepts years about +-270 000, but the arithmetic on them (zones, rules) throws: that
    // used to surface as a 500. Nobody books a room in the year 9999.
    if (
      Temporal.Instant.compare(value, MIN_INSTANT) < 0 ||
      Temporal.Instant.compare(value, MAX_INSTANT) >= 0
    ) {
      ctx.addIssue({ code: 'custom', message: 'must be between the years 1970 and 2199' });
      return z.NEVER;
    }
    return value.toString();
  } catch {
    ctx.addIssue({
      code: 'custom',
      message: 'must be an ISO 8601 instant with offset, e.g. 2026-03-30T07:00:00Z',
    });
    return z.NEVER;
  }
});

const noNul = (s: string) => !s.includes('\u0000');
const uuid = z.uuid();
const timeZone = z.string().refine(isValidTimeZone, 'must be an IANA time zone');

const fields = {
  roomId: uuid,
  // Postgres cannot store a NUL character in text: refuse it here instead of failing with a 500.
  title: z
    .string()
    .refine(noNul, 'must not contain a NUL character')
    .pipe(z.string().trim().min(1).max(200)),
  description: z
    .string()
    .refine(noNul, 'must not contain a NUL character')
    .pipe(z.string().max(5000)),
  startAt: instant,
  endAt: instant,
  allDay: z.boolean(),
  tzid: timeZone,
  rrule: z.string().max(300).nullable(),
  attendeeIds: z
    .array(uuid)
    .max(MAX_ATTENDEES)
    .refine((a) => new Set(a).size === a.length, 'must be unique'),
};

export const createEventSchema = z.strictObject({
  id: uuid.optional(),
  roomId: fields.roomId,
  title: fields.title,
  description: fields.description.default(''),
  startAt: fields.startAt,
  endAt: fields.endAt,
  allDay: fields.allDay.default(false),
  tzid: fields.tzid.optional(),
  rrule: fields.rrule.optional().transform((v) => v ?? null),
  attendeeIds: fields.attendeeIds.default([]),
});
export type CreateEventInput = z.infer<typeof createEventSchema>;

export const scopeSchema = z.enum(['this', 'following', 'all']);
export type Scope = z.infer<typeof scopeSchema>;

export const updateEventSchema = z
  .strictObject({
    version: z.number().int().min(1),
    scope: scopeSchema.optional(),
    occurrenceStart: instant.optional(),
    roomId: fields.roomId.optional(),
    title: fields.title.optional(),
    description: fields.description.optional(),
    startAt: fields.startAt.optional(),
    endAt: fields.endAt.optional(),
    allDay: fields.allDay.optional(),
    tzid: fields.tzid.optional(),
    rrule: fields.rrule.optional(),
    attendeeIds: fields.attendeeIds.optional(),
  })
  .refine((v) => (v.startAt === undefined) === (v.endAt === undefined), {
    message: 'startAt and endAt must be sent together',
    path: ['startAt'],
  })
  .refine((v) => Object.keys(v).some((k) => !['version', 'scope', 'occurrenceStart'].includes(k)), {
    message: 'nothing to change',
  });
export type UpdateEventInput = z.infer<typeof updateEventSchema>;

export const deleteQuerySchema = z.object({
  version: z.coerce.number().int().min(1),
  scope: scopeSchema.optional(),
  occurrenceStart: instant.optional(),
});
export type DeleteEventQuery = z.infer<typeof deleteQuerySchema>;

export const listQuerySchema = z
  .object({
    from: instant,
    to: instant,
    rooms: z
      .string()
      .optional()
      .transform((v) => (v ? v.split(',') : undefined))
      .pipe(z.array(uuid).max(50).optional()),
  })
  .refine((q) => Temporal.Instant.compare(q.from, q.to) < 0, {
    message: 'from must be before to',
    path: ['to'],
  })
  .refine(
    (q) => parseInstant(q.to).since(parseInstant(q.from)).total('hours') <= MAX_LIST_DAYS * 24,
    { message: `range is limited to ${MAX_LIST_DAYS} days`, path: ['to'] },
  );
export type ListQuery = z.infer<typeof listQuerySchema>;

export type ShapeIssue = { path: string; message: string };

/** Rules about the event as a whole that a field-by-field schema cannot express. */
export function checkEventShape(src: RecurringSource): ShapeIssue | null {
  const start = parseInstant(src.startAt);
  const end = parseInstant(src.endAt);
  if (Temporal.Instant.compare(end, start) <= 0) {
    return { path: 'endAt', message: 'must be after startAt (in real time)' };
  }
  if (src.allDay) {
    const [s, e] = [wallClock(start, src.tzid), wallClock(end, src.tzid)];
    const midnight = (p: Temporal.PlainDateTime) =>
      p.toPlainTime().equals(new Temporal.PlainTime());
    if (!midnight(s) || !midnight(e)) {
      return { path: 'allDay', message: 'all-day events must start and end at local midnight' };
    }
  }
  return src.rrule === null ? null : checkRule(src, src.rrule);
}

const DAY = '(MO|TU|WE|TH|FR|SA|SU)';
/** What each part of a rule may look like. Anything else (unknown parts, odd numbers) is refused. */
const RULE_PARTS: Record<string, RegExp> = {
  FREQ: /^(DAILY|WEEKLY|MONTHLY)$/,
  // 1..99, the same range the form offers.
  INTERVAL: /^[1-9][0-9]?$/,
  COUNT: /^[1-9][0-9]{0,3}$/,
  UNTIL: /^[0-9]{8}(T[0-9]{6}Z?)?$/,
  BYDAY: new RegExp(`^([+-]?[1-5])?${DAY}(,([+-]?[1-5])?${DAY})*$`),
  BYMONTHDAY: /^[+-]?([1-9]|[12][0-9]|3[01])(,[+-]?([1-9]|[12][0-9]|3[01]))*$/,
};

/** A list may not be longer than there are distinct values (a repeated day only inflates the work). */
const MAX_LIST_ITEMS: Record<string, number> = { BYDAY: 7, BYMONTHDAY: 31 };

/** A series may not end more than this many years after it starts: UNTIL=9999 would expand for ages. */
export const MAX_RULE_YEARS = 10;

/** A strict, whitelist check of `NAME=value;...`: known names once each, values in range. */
export function ruleSyntaxProblem(rrule: string): string | null {
  const seen = new Set<string>();
  for (const part of rrule.split(';')) {
    const [name = '', value = '', ...extra] = part.split('=');
    const pattern = RULE_PARTS[name];
    if (!pattern) return `unsupported rule part "${name}"`;
    if (extra.length > 0 || !pattern.test(value)) return `invalid ${name}`;
    if (name in MAX_LIST_ITEMS && value.split(',').length > (MAX_LIST_ITEMS[name] ?? 0)) {
      return `too many values in ${name}`;
    }
    if (seen.has(name)) return `${name} given twice`;
    seen.add(name);
  }
  return seen.has('FREQ') ? null : 'FREQ is required';
}

function checkRule(src: RecurringSource, rrule: string): ShapeIssue | null {
  const bad = (message: string): ShapeIssue => ({ path: 'rrule', message });
  if (!/^[A-Z0-9=;,+-]+$/.test(rrule)) return bad('malformed rule (use e.g. FREQ=WEEKLY;BYDAY=MO)');
  // Every part is checked here, BEFORE the rrule library sees the string: it trusts its input, and a
  // negative INTERVAL makes it loop forever (which would freeze the whole server).
  const syntax = ruleSyntaxProblem(rrule);
  if (syntax) return bad(syntax);
  let options;
  try {
    options = RRule.parseString(rrule);
  } catch {
    return bad('cannot parse rule');
  }
  const allowed = [RRule.DAILY, RRule.WEEKLY, RRule.MONTHLY];
  if (options.freq === undefined || !allowed.includes(options.freq)) {
    return bad('FREQ must be DAILY, WEEKLY or MONTHLY');
  }
  if (!startMatchesRule(src)) return bad('startAt must be the first occurrence of the rule');
  if (isFiniteRule(rrule)) {
    // UNTIL is a wall-clock bound in the event zone: refuse one that is absurdly far from the start.
    if (options.until) {
      const until = Temporal.PlainDate.from({
        year: options.until.getUTCFullYear(),
        month: options.until.getUTCMonth() + 1,
        day: options.until.getUTCDate(),
      });
      const first = wallClock(parseInstant(src.startAt), src.tzid).toPlainDate();
      if (Temporal.PlainDate.compare(until, first.add({ years: MAX_RULE_YEARS })) > 0) {
        return bad(`UNTIL must be within ${MAX_RULE_YEARS} years of the start`);
      }
    }
    try {
      // Stop one past the limit: all we need to know is whether it is exceeded.
      if (expandAll(src, MAX_FINITE_OCCURRENCES + 1).length > MAX_FINITE_OCCURRENCES) {
        return bad(`a series is limited to ${MAX_FINITE_OCCURRENCES} occurrences`);
      }
    } catch {
      return bad('cannot expand rule');
    }
  }
  return null;
}
