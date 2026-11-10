import type { DirectoryUser, OccurrenceDto, RoomDto } from '@/shared/contracts';

/** Fixed data shared by the unit tests and Storybook (through the same MSW handlers). */
export const mockRooms: RoomDto[] = [
  { id: 'room-a', name: 'Aurora', floor: 1, capacity: 4 },
  { id: 'room-b', name: 'Borealis', floor: 2, capacity: 8 },
  { id: 'room-c', name: 'Cosmos', floor: 3, capacity: 12 },
];

export const mockUsers: DirectoryUser[] = [
  { id: 'u-ana', name: 'Ana', email: 'ana@example.com', timezone: 'Europe/Kyiv' },
  { id: 'u-bob', name: 'Bob', email: 'bob@example.com', timezone: 'America/New_York' },
];

export function occurrence(
  over: Partial<OccurrenceDto> & Pick<OccurrenceDto, 'start' | 'end'>,
): OccurrenceDto {
  return {
    eventId: `ev-${over.start}-${over.roomId ?? 'room-a'}`,
    roomId: 'room-a',
    title: 'Meeting',
    description: '',
    allDay: false,
    tzid: 'Europe/Kyiv',
    recurring: false,
    seriesId: null,
    version: 1,
    creator: { id: 'u-ana', name: 'Ana' },
    attendeeIds: [],
    ...over,
  };
}

/** Aurora is booked 10:00–11:00 UTC on 2026-12-01, Borealis 10:30–11:30: used to test "free rooms". */
export const mockOccurrences: OccurrenceDto[] = [
  occurrence({
    eventId: 'ev-aurora',
    roomId: 'room-a',
    title: 'Design review',
    start: '2026-12-01T10:00:00Z',
    end: '2026-12-01T11:00:00Z',
  }),
  occurrence({
    eventId: 'ev-borealis',
    roomId: 'room-b',
    title: 'Planning',
    start: '2026-12-01T10:30:00Z',
    end: '2026-12-01T11:30:00Z',
  }),
];
