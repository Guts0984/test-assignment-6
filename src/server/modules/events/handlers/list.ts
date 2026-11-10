import { Temporal } from '@js-temporal/polyfill';
import type { NextRequest, NextResponse } from 'next/server';
import { json, parseQuery, validationError } from '@/server/core/http';
import { authorize, isDenied, type AuthDeps } from '@/server/modules/auth/http';
import { listOccurrences } from '../repository';
import { extendOpenSeries } from '../service';
import { listQuerySchema } from '../validation';

/** Windows further than this from today are refused (reads can extend open-ended series). */
const MAX_YEARS_AHEAD = 5;

export const makeListEventsHandler =
  (deps: AuthDeps) =>
  async (req: NextRequest): Promise<NextResponse> => {
    const ctx = await authorize(deps, req, { mutating: false });
    if (isDenied(ctx)) return ctx;
    const query = parseQuery(req, listQuerySchema);
    if (!query.ok) return query.response;

    const { from, to, rooms } = query.data;
    const today = ctx.now.toZonedDateTimeISO('UTC');
    const [latest, earliest] = [
      today.add({ years: MAX_YEARS_AHEAD }).toInstant(),
      today.subtract({ years: MAX_YEARS_AHEAD }).toInstant(),
    ];
    if (
      Temporal.Instant.compare(Temporal.Instant.from(to), latest) > 0 ||
      Temporal.Instant.compare(Temporal.Instant.from(from), earliest) < 0
    ) {
      return validationError([
        { path: 'from', message: `must be within ${MAX_YEARS_AHEAD} years of today` },
      ]);
    }
    const db = deps.db();
    await extendOpenSeries(db, Temporal.Instant.from(to));
    return json({ occurrences: await listOccurrences(db, { from, to, rooms }) });
  };
