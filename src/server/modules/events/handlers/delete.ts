import type { NextRequest, NextResponse } from 'next/server';
import { apiError, parseQuery } from '@/server/core/http';
import { authorize, isDenied, type AuthDeps } from '@/server/modules/auth/http';
import { deleteEvent } from '../service';
import { deleteQuerySchema } from '../validation';
import { eventIdOf, respondAndPublish, type RouteContext } from './shared';

export const makeDeleteEventHandler =
  (deps: AuthDeps) =>
  async (req: NextRequest, route: RouteContext): Promise<NextResponse> => {
    const ctx = await authorize(deps, req, { mutating: true });
    if (isDenied(ctx)) return ctx;
    const id = await eventIdOf(route);
    if (!id) return apiError(404, 'NOT_FOUND');
    const query = parseQuery(req, deleteQuerySchema);
    if (!query.ok) return query.response;
    return respondAndPublish(req, await deleteEvent(deps.db(), id, query.data));
  };
