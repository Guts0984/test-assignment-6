import type { NextResponse } from 'next/server';
import { z } from 'zod';
import type { Result } from '@/server/core/db';
import { apiError, json } from '@/server/core/http';
import { originOf, publishChange } from '@/server/modules/realtime';
import type { NextRequest } from 'next/server';
import type { MutationResult } from '../service';

/** Next.js passes dynamic route segments (`/api/events/[id]`) as a promise. */
export type RouteContext = { params: Promise<{ id: string }> };

const idSchema = z.uuid();

/** The `[id]` segment as a UUID, or null (which routes answer with 404, not 400). */
export async function eventIdOf({ params }: RouteContext): Promise<string | null> {
  const parsed = idSchema.safeParse((await params).id);
  return parsed.success ? parsed.data : null;
}

/** Service results become responses: the value as JSON, or the error as `{ error: { code } }`. */
export const respond = <T>(result: Result<T>, status = 200): NextResponse =>
  result.ok
    ? json(result.value, status)
    : apiError(result.error.status, result.error.code, result.error.details);

/**
 * Answers a mutation and, when it succeeded, tells every connected client what changed.
 * The author's X-Client-Id travels with the message so their own browser can skip the echo.
 */
export function respondAndPublish(
  req: NextRequest,
  result: Result<MutationResult>,
  status = 200,
  /** Who made the change (the author's client id is shown to this user's own tabs only). */
  userId: string | null = null,
): NextResponse {
  if (result.ok && !result.value.replayed) {
    publishChange(
      'events-changed',
      { changed: result.value.events, deletedEventIds: result.value.deletedEventIds },
      originOf(req.headers),
      userId,
    );
  }
  return respond(result, result.ok && result.value.replayed ? 200 : status);
}
