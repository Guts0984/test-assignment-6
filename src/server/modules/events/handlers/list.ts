import { Temporal } from '@js-temporal/polyfill';
import type { NextRequest, NextResponse } from 'next/server';
import { json, parseQuery, validationError } from '@/server/core/http';
import { authorize, isDenied, type AuthDeps } from '@/server/modules/auth/http';
import { listOccurrences } from '../repository';
import { extendOpenSeries } from '../service';
import { listQuerySchema } from '../validation';
import { isSupportedWindow, MAX_YEARS_AHEAD } from '../window';

export const makeListEventsHandler =
  (deps: AuthDeps) =>
  async (req: NextRequest): Promise<NextResponse> => {
    const ctx = await authorize(deps, req, { mutating: false });
    if (isDenied(ctx)) return ctx;
    const query = parseQuery(req, listQuerySchema);
    if (!query.ok) return query.response;

    const { from, to, rooms } = query.data;
    if (!isSupportedWindow(Temporal.Instant.from(from), Temporal.Instant.from(to), ctx.now)) {
      return validationError([
        { path: 'from', message: `must be within ${MAX_YEARS_AHEAD} years of today` },
      ]);
    }
    const db = deps.db();
    await extendOpenSeries(db, Temporal.Instant.from(to), ctx.now);
    return json({ occurrences: await listOccurrences(db, { from, to, rooms }) });
  };
