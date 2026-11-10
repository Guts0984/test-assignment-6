import { fromOccurrence } from '@/shared/calendar';
import type { OccurrenceDto } from '@/shared/contracts';
import type { Period } from './cache';

/** Server-side and client-side: wraps API occurrences as a cached period. (No 'use client': pure.) */
export const toPeriod = (from: number, to: number, occurrences: OccurrenceDto[]): Period => ({
  from,
  to,
  events: occurrences.map(fromOccurrence),
});
