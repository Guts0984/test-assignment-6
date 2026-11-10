import type { NextRequest, NextResponse } from 'next/server';
import type { ZodError, ZodType } from 'zod';
import { validationError, type Issue } from './response';

export type Parsed<T> = { ok: true; data: T } | { ok: false; response: NextResponse };

export const issuesOf = (error: ZodError): Issue[] =>
  error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));

/** Reads and validates a JSON body. Malformed JSON and schema errors both become a 400. */
export async function parseBody<T>(req: NextRequest, schema: ZodType<T>): Promise<Parsed<T>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return { ok: false, response: validationError([{ path: '', message: 'body must be JSON' }]) };
  }
  const result = schema.safeParse(raw);
  return result.success
    ? { ok: true, data: result.data }
    : { ok: false, response: validationError(issuesOf(result.error)) };
}

/** Validates the query string (`?a=1&b=2`) of a request. */
export function parseQuery<T>(req: NextRequest, schema: ZodType<T>): Parsed<T> {
  const result = schema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  return result.success
    ? { ok: true, data: result.data }
    : { ok: false, response: validationError(issuesOf(result.error)) };
}
