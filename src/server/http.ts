import { NextResponse, type NextRequest } from 'next/server';
import type { ZodType } from 'zod';

export type ApiErrorCode =
  | 'VALIDATION'
  | 'INVALID_CREDENTIALS'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN_ORIGIN'
  | 'NOT_FOUND'
  | 'VERSION_CONFLICT'
  | 'ROOM_CONFLICT';

export const json = (body: unknown, status = 200): NextResponse =>
  NextResponse.json(body, { status });

/** Errors are `{ error: { code, details? } }`; the UI maps `code` to a translated message. */
export const apiError = (status: number, code: ApiErrorCode, details?: unknown): NextResponse =>
  json({ error: { code, ...(details === undefined ? {} : { details }) } }, status);

export type Parsed<T> = { ok: true; data: T } | { ok: false; response: NextResponse };

/** Reads and validates a JSON body. Malformed JSON and schema errors both become a 400. */
export async function parseBody<T>(req: NextRequest, schema: ZodType<T>): Promise<Parsed<T>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return { ok: false, response: apiError(400, 'VALIDATION', [{ message: 'body must be JSON' }]) };
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const details = result.error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    }));
    return { ok: false, response: apiError(400, 'VALIDATION', details) };
  }
  return { ok: true, data: result.data };
}

export function isSameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.get('host');
  } catch {
    return false;
  }
}
