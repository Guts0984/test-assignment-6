import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Instants are `timestamptz` read/written as strings (mode: 'string') so no JS `Date`
 * ever touches time zone logic; parsing happens in the Temporal layer.
 */
const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });

/** Postgres range of timestamptz, e.g. `[2026-03-30 07:00+00,2026-03-30 08:00+00)`. */
const tstzrange = customType<{ data: string; driverData: string }>({
  dataType: () => 'tstzrange',
});

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    name: text('name').notNull(),
    /** IANA zone from the profile; the source of truth for rendering (not the browser). */
    timezone: text('timezone').notNull().default('UTC'),
    locale: text('locale').notNull().default('uk'),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('users_email_lower_uq').on(sql`lower(${t.email})`),
    check('users_locale_chk', sql`${t.locale} in ('uk', 'en')`),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    /** SHA-256 of the cookie token; the raw token is never stored. */
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: tstz('expires_at').notNull(),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const rooms = pgTable(
  'rooms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull().unique(),
    floor: integer('floor').notNull(),
    capacity: integer('capacity').notNull(),
  },
  (t) => [check('rooms_capacity_chk', sql`${t.capacity} > 0`)],
);

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
