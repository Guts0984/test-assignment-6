import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { tstz, tstzrange } from '@/server/core/db';
import { users } from '@/server/modules/auth/schema';
import { rooms } from '@/server/modules/rooms/schema';

/**
 * An event, or the master of a recurring series.
 * `startAt`/`endAt` describe the FIRST occurrence in UTC; the wall-clock time for recurrence
 * expansion is derived from them in `tzid`, so "Mondays 9:00 Kyiv" stays 9:00 across DST.
 * `materializedUntil` is set only for open-ended series (finite ones are fully materialized).
 */
export const events = pgTable(
  'events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'restrict' }),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    startAt: tstz('start_at').notNull(),
    endAt: tstz('end_at').notNull(),
    allDay: boolean('all_day').notNull().default(false),
    tzid: text('tzid').notNull(),
    rrule: text('rrule'),
    exdates: tstz('exdates')
      .array()
      .notNull()
      .default(sql`'{}'`),
    seriesId: uuid('series_id'),
    originalStart: tstz('original_start'),
    /** Optimistic concurrency: PATCH must send the version it saw; bumped on every write. */
    version: integer('version').notNull().default(1),
    /** Recurring only: occurrences are materialized up to this instant. */
    materializedUntil: tstz('materialized_until'),
    createdAt: tstz('created_at').notNull().defaultNow(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    // Target for the composite FK from event_occurrences (keeps its room_id in sync).
    unique('events_id_room_uq').on(t.id, t.roomId),
    // Deleting a series ("all") also deletes its detached single-occurrence edits.
    foreignKey({
      columns: [t.seriesId],
      foreignColumns: [t.id],
      name: 'events_series_fk',
    }).onDelete('cascade'),
    check('events_title_chk', sql`char_length(${t.title}) between 1 and 200`),
    check('events_range_chk', sql`${t.endAt} > ${t.startAt}`),
    check('events_version_chk', sql`${t.version} >= 1`),
    check('events_detached_chk', sql`(${t.seriesId} is null) = (${t.originalStart} is null)`),
    index('events_room_start_idx').on(t.roomId, t.startAt),
    index('events_series_idx').on(t.seriesId),
  ],
);

export const eventAttendees = pgTable(
  'event_attendees',
  {
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.userId] }), index('attendees_user_idx').on(t.userId)],
);

/**
 * Every concrete occupation of a room. The exclusion constraint that forbids overlaps in one room
 * lives in the custom migration `0001_room_exclusion.sql` (Drizzle cannot express it).
 */
export const eventOccurrences = pgTable(
  'event_occurrences',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id').notNull(),
    roomId: uuid('room_id').notNull(),
    during: tstzrange('during').notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.eventId, t.roomId],
      foreignColumns: [events.id, events.roomId],
      name: 'occurrences_event_room_fk',
    })
      .onDelete('cascade')
      .onUpdate('cascade'),
    index('occurrences_event_idx').on(t.eventId),
    index('occurrences_during_gist').using('gist', t.during),
    check(
      'occurrences_during_chk',
      sql`not isempty(${t.during}) and not lower_inf(${t.during}) and not upper_inf(${t.during})`,
    ),
  ],
);
