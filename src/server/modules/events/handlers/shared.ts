import type { NextResponse } from 'next/server';
import { z } from 'zod';
import type { Result } from '@/server/core/db';
import { apiError, json } from '@/server/core/http';

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
