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
const instant = z.string().transform((s, ctx) => {
  try {
    return Temporal.Instant.from(s).toString();
  } catch {
    ctx.addIssue({
      code: 'custom',
      message: 'must be an ISO 8601 instant with offset, e.g. 2026-03-30T07:00:00Z',
    });
    return z.NEVER;
  }
});

const uuid = z.uuid();
const timeZone = z.string().refine(isValidTimeZone, 'must be an IANA time zone');

const fields = {
  roomId: uuid,
  title: z.string().trim().min(1).max(200),
  description: z.string().max(5000),
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

function checkRule(src: RecurringSource, rrule: string): ShapeIssue | null {
  const bad = (message: string): ShapeIssue => ({ path: 'rrule', message });
  if (!/^[A-Z0-9=;,+-]+$/.test(rrule)) return bad('malformed rule (use e.g. FREQ=WEEKLY;BYDAY=MO)');
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
    try {
      if (expandAll(src).length > MAX_FINITE_OCCURRENCES) {
        return bad(`a series is limited to ${MAX_FINITE_OCCURRENCES} occurrences`);
      }
    } catch {
      return bad('cannot expand rule');
    }
  }
  return null;
}
