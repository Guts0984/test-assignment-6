import { NextResponse } from 'next/server';

/** Machine-readable error vocabulary of the API. The UI translates these codes. */
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

/** Errors are `{ error: { code, details? } }`. */
export const apiError = (status: number, code: ApiErrorCode, details?: unknown): NextResponse =>
  json({ error: { code, ...(details === undefined ? {} : { details }) } }, status);

export type Issue = { path: string; message: string };

export const validationError = (issues: Issue[]): NextResponse =>
  apiError(400, 'VALIDATION', issues);
