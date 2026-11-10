import { customType, timestamp } from 'drizzle-orm/pg-core';

/**
 * Instants are `timestamptz` read/written as strings (mode: 'string') so no JS `Date`
 * ever touches time zone logic; parsing happens in the Temporal layer (`@/shared/time`).
 */
export const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });

/** Postgres range of timestamptz, e.g. `[2026-03-30 07:00+00,2026-03-30 08:00+00)`. */
export const tstzrange = customType<{ data: string; driverData: string }>({
  dataType: () => 'tstzrange',
});
