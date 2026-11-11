import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { tstz } from '@/server/core/db';

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

/**
 * Failed sign-in attempts, for the sign-in rate limit. Kept in the database (not in the memory of one
 * server process) so the counts survive a restart and are shared by every instance of the app.
 * `key` is `account:<email>` or `ip:<address>`.
 */
export const loginFailures = pgTable(
  'login_failures',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: text('key').notNull(),
    at: tstz('at').notNull().defaultNow(),
  },
  (t) => [index('login_failures_key_at_idx').on(t.key, t.at)],
);
