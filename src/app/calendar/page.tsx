import { redirect } from 'next/navigation';
import { Temporal } from '@js-temporal/polyfill';
import { CalendarApp, parseLocation, rangeOf, weekStartOf } from '@/features/calendar';
import { toPeriod } from '@/features/events';
import { getDb } from '@/server/core/db';
import { listUsers } from '@/server/modules/auth';
import { extendOpenSeries, listOccurrences } from '@/server/modules/events';
import { listRooms } from '@/server/modules/rooms';
import { formatInstant } from '@/shared/zoned';
import { getPageSettings } from '../settings';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * The first screen is rendered on the server, in the PROFILE time zone and locale, with the data of
 * the visible period already in the HTML. The browser then hydrates the same tree.
 */
export default async function CalendarPage({ searchParams }: { searchParams: SearchParams }) {
  const settings = await getPageSettings();
  if (!settings.user) redirect('/login');

  const now = Temporal.Now.instant().epochMilliseconds;
  const location = parseLocation(await searchParams, now, settings.timeZone);
  const range = rangeOf(
    location.view,
    location.date,
    weekStartOf(settings.locale),
    settings.timeZone,
  );

  const db = getDb();
  await extendOpenSeries(db, Temporal.Instant.fromEpochMilliseconds(range.to));
  const [rooms, users, occurrences] = await Promise.all([
    listRooms(db),
    listUsers(db),
    listOccurrences(db, { from: formatInstant(range.from), to: formatInstant(range.to) }),
  ]);

  return (
    <CalendarApp
      user={settings.user}
      locale={settings.locale}
      clock={settings.clock}
      tz2={settings.tz2}
      theme={settings.theme}
      initialLocation={location}
      initial={{ period: toPeriod(range.from, range.to, occurrences), rooms, users }}
    />
  );
}
