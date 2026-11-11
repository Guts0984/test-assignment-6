/**
 * The HTTP API contract: the shapes the server sends and the browser reads.
 * Types only (no runtime code), so importing this costs the browser nothing.
 * Instants are ISO 8601 UTC strings (`2026-03-30T07:00:00Z`).
 */

/** Machine-readable error vocabulary. The UI translates these codes. */
export type ApiErrorCode =
  | 'VALIDATION'
  | 'INVALID_CREDENTIALS'
  | 'TOO_MANY_ATTEMPTS'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN_ORIGIN'
  | 'NOT_FOUND'
  | 'VERSION_CONFLICT'
  | 'ROOM_CONFLICT';

export type Issue = { path: string; message: string };

/** Every error response: `{ error: { code, details? } }`. */
export type ApiErrorBody = { error: { code: ApiErrorCode; details?: unknown } };

export type PublicUser = {
  id: string;
  email: string;
  name: string;
  /** IANA zone from the profile: the source of truth for rendering, not the browser's. */
  timezone: string;
  locale: 'uk' | 'en' | string;
};

export type DirectoryUser = Pick<PublicUser, 'id' | 'name' | 'email' | 'timezone'>;

export type RoomDto = { id: string; name: string; floor: number; capacity: number };

/** An event, or the master of a recurring series. */
export type EventDto = {
  id: string;
  roomId: string;
  title: string;
  description: string;
  startAt: string;
  endAt: string;
  allDay: boolean;
  tzid: string;
  rrule: string | null;
  exdates: string[];
  /** Set for a single edited occurrence that was detached from a series. */
  seriesId: string | null;
  originalStart: string | null;
  version: number;
  creatorId: string;
  attendeeIds: string[];
};

/** One concrete occurrence in `GET /api/events`: recurring series are already expanded. */
export type OccurrenceDto = {
  eventId: string;
  roomId: string;
  title: string;
  description: string;
  start: string;
  end: string;
  allDay: boolean;
  tzid: string;
  recurring: boolean;
  seriesId: string | null;
  version: number;
  creator: { id: string; name: string };
  attendeeIds: string[];
};

/** Who is in the way when a booking is refused with ROOM_CONFLICT. */
export type Blocker = {
  eventId: string;
  title: string;
  creator: { id: string; name: string };
  start: string;
  end: string;
};

export type Scope = 'this' | 'following' | 'all';

/** Result of any event mutation: what changed and what disappeared. */
export type MutationResult = {
  events: EventDto[];
  deletedEventIds: string[];
  /** A repeated create (same client-chosen id) that changed nothing: it is already on the server. */
  replayed?: boolean;
};

export type CreateEventBody = {
  /** Client-chosen UUID: makes retrying a create safe (see replayed). */
  id?: string;
  roomId: string;
  title: string;
  description?: string;
  startAt: string;
  endAt: string;
  allDay?: boolean;
  tzid?: string;
  rrule?: string | null;
  attendeeIds?: string[];
};

export type UpdateEventBody = Partial<Omit<CreateEventBody, 'tzid'> & { tzid: string }> & {
  version: number;
  scope?: Scope;
  occurrenceStart?: string;
};

/** Payload of the `events-changed` server-sent event. */
export type EventsChangedMessage = { changed: EventDto[]; deletedEventIds: string[] };
