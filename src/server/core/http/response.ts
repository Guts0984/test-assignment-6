import { NextResponse } from 'next/server';
import type { ApiErrorCode, Issue } from '@/shared/contracts';

export type { ApiErrorCode, Issue };

export const json = (body: unknown, status = 200): NextResponse =>
  NextResponse.json(body, { status });

/** Errors are `{ error: { code, details? } }`. */
export const apiError = (status: number, code: ApiErrorCode, details?: unknown): NextResponse =>
  json({ error: { code, ...(details === undefined ? {} : { details }) } }, status);

export const validationError = (issues: Issue[]): NextResponse =>
  apiError(400, 'VALIDATION', issues);
