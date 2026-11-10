import { parseInstant } from '@/shared/zoned';
import type { CalEvent } from './types';

/** Builds a CalEvent from ISO instants for tests and stories. */
export function makeEvent(start: string, end: string, over: Partial<CalEvent> = {}): CalEvent {
  const s = parseInstant(start);
  const e = parseInstant(end);
  if (s === null || e === null) throw new Error(`bad test times ${start}..${end}`);
  const eventId = over.eventId ?? `ev-${start}`;
  return {
    key: `${eventId}@${start}`,
    eventId,
    roomId: 'room-a',
    title: 'Meeting',
    description: '',
    start: s,
    end: e,
    allDay: false,
    tzid: 'Europe/Kyiv',
    recurring: false,
    seriesId: null,
    version: 1,
    creatorId: 'u1',
    creatorName: 'Ana',
    attendeeIds: [],
    ...over,
  };
}
