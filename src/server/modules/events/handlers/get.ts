import type { NextRequest, NextResponse } from 'next/server';
import { apiError, json } from '@/server/core/http';
import { authorize, isDenied, type AuthDeps } from '@/server/modules/auth/http';
import { getEvent } from '../service';
import { eventIdOf, respond, type RouteContext } from './shared';

export const makeGetEventHandler =
  (deps: AuthDeps) =>
  async (req: NextRequest, route: RouteContext): Promise<NextResponse> => {
    const ctx = await authorize(deps, req, { mutating: false });
    if (isDenied(ctx)) return ctx;
    const id = await eventIdOf(route);
    if (!id) return apiError(404, 'NOT_FOUND');
    const result = await getEvent(deps.db(), id);
    return result.ok ? json({ event: result.value }) : respond(result);
  };
