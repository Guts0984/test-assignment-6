import type { NextRequest, NextResponse } from 'next/server';
import { apiError, parseBody } from '@/server/core/http';
import { authorize, isDenied, type AuthDeps } from '@/server/modules/auth/http';
import { updateEvent } from '../service';
import { updateEventSchema } from '../validation';
import { eventIdOf, respondAndPublish, type RouteContext } from './shared';

export const makeUpdateEventHandler =
  (deps: AuthDeps) =>
  async (req: NextRequest, route: RouteContext): Promise<NextResponse> => {
    const ctx = await authorize(deps, req, { mutating: true });
    if (isDenied(ctx)) return ctx;
    const id = await eventIdOf(route);
    if (!id) return apiError(404, 'NOT_FOUND');
    const body = await parseBody(req, updateEventSchema);
    if (!body.ok) return body.response;
    return respondAndPublish(
      req,
      await updateEvent(deps.db(), ctx, id, body.data),
      200,
      ctx.user.id,
    );
  };
