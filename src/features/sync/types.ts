import type {
  Blocker,
  CreateEventBody,
  EventDto,
  MutationResult,
  Scope,
  UpdateEventBody,
} from '@/shared/contracts';

/**
 * One user action as data. It is serializable (it is stored in IndexedDB while offline) and carries
 * the version the user acted on, so a conflicting change by somebody else is detected at replay time.
 */
type Base = {
  /** Unique id of this command. */
  id: string;
  /** The event it concerns. For a create it is the client-chosen id the event will have. */
  eventId: string;
  queuedAt: number;
  /** True once the command had to wait for the network (or survived a page reload). */
  offline: boolean;
};

export type CreateCommand = Base & { kind: 'create'; body: CreateEventBody };
export type UpdateCommand = Base & {
  kind: 'update';
  baseVersion: number;
  body: Omit<UpdateEventBody, 'version'>;
};
export type DeleteCommand = Base & {
  kind: 'delete';
  baseVersion: number;
  scope?: Scope;
  occurrenceStart?: string;
};
export type Command = CreateCommand | UpdateCommand | DeleteCommand;

/** What the network layer reports for one attempt. The engine decides what each outcome means. */
export type SendResult =
  | { type: 'ok'; result: MutationResult }
  | { type: 'network' }
  | { type: 'unauthenticated' }
  | { type: 'version-conflict'; current: EventDto | null }
  | { type: 'room-conflict'; blockers: Blocker[] }
  | { type: 'not-found' }
  | { type: 'invalid'; details: unknown }
  | { type: 'error'; status: number; code: string };

export type Transport = {
  /** Sends the command using `version` (the engine resolves it, see version chaining). */
  send: (command: Command, version: number) => Promise<SendResult>;
};

/** Where the queue survives a page reload. */
export type QueueStorage = {
  load: () => Promise<Command[]>;
  save: (queue: readonly Command[]) => Promise<void>;
};

export type Rejection =
  | { kind: 'room-conflict'; blockers: Blocker[] }
  | { kind: 'version-conflict'; current: EventDto | null }
  | { kind: 'not-found' }
  | { kind: 'invalid'; details: unknown }
  | { kind: 'error'; status: number; code: string };

/** An offline change that clashes with somebody else's change: waiting for the user's choice. */
export type Conflict = { command: UpdateCommand | DeleteCommand; current: EventDto | null };

export type SyncStatus =
  /** Nothing waiting, nothing in flight. */
  | 'saved'
  /** Sending queued changes. */
  | 'syncing'
  /** The network is unreachable; changes wait in the queue. */
  | 'offline'
  /** An offline change conflicts with a newer server version: the user has to choose. */
  | 'conflict'
  /** The session expired: the queue is kept until the user signs in again. */
  | 'signed-out';

export type SyncState = {
  status: SyncStatus;
  /** Number of queued changes (including the one in flight). */
  pending: number;
  conflict: Conflict | null;
  /** The queue could not be written to IndexedDB: changes would be lost on reload. */
  storageFailed: boolean;
};

export type Handlers = {
  /** The server accepted `command`. `lastForEvent` = nothing else is queued for that event. */
  onApplied?: (command: Command, result: MutationResult, info: { lastForEvent: boolean }) => void;
  /** The server refused `command`; the optimistic change must be rolled back and explained. */
  onRejected?: (command: Command, rejection: Rejection) => void;
  /** The user chose the server's version: these commands were dropped; reset the event to `current`. */
  onDiscarded?: (commands: Command[], current: EventDto | null) => void;
};
