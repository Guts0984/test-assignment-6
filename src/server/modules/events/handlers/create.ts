import type { NextRequest, NextResponse } from 'next/server';
import { parseBody } from '@/server/core/http';
import { authorize, isDenied, type AuthDeps } from '@/server/modules/auth/http';
import { createEvent } from '../service';
import { createEventSchema } from '../validation';
import { respondAndPublish } from './shared';

export const makeCreateEventHandler =
  (deps: AuthDeps) =>
  async (req: NextRequest): Promise<NextResponse> => {
    const ctx = await authorize(deps, req, { mutating: true });
    if (isDenied(ctx)) return ctx;
    const body = await parseBody(req, createEventSchema);
    if (!body.ok) return body.response;
    return respondAndPublish(req, await createEvent(deps.db(), ctx, body.data), 201, ctx.user.id);
  };
