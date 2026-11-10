import type { EventsChangedMessage } from '@/shared/contracts';
import type { Scheduler } from './engine';

/** The slice of the browser's EventSource we use, so tests can supply a fake. */
export type EventSourceLike = {
  readyState: number;
  onopen: ((e: unknown) => void) | null;
  onerror: ((e: unknown) => void) | null;
  addEventListener: (
    type: string,
    listener: (e: { data: string; lastEventId?: string }) => void,
  ) => void;
  close: () => void;
};

export type StreamHandlers = {
  /** Somebody ELSE changed events. (Our own echoes are filtered out here.) */
  onChanged: (message: EventsChangedMessage) => void;
  /** First connection, or a reconnect that could not be replayed: re-read what is on screen. */
  onRefetch: () => void;
  onConnection?: (connected: boolean) => void;
};

export type StreamOptions = {
  url: string;
  clientId: string;
  create?: (url: string) => EventSourceLike;
  schedule?: Scheduler;
  /** Delay before reopening a stream the browser gave up on (e.g. after a 401). */
  reopenMs?: number;
};

const CLOSED = 2;
const defaultSchedule: Scheduler = (run, ms) => {
  const id = setTimeout(run, ms);
  return () => clearTimeout(id);
};

/**
 * Live changes from other users over Server-Sent Events.
 *  - EventSource reconnects by itself and sends Last-Event-ID, so the server replays what we missed.
 *  - `hello` (fresh connection) and `resync` (the server cannot replay) both mean "refetch what you show".
 *  - A message whose `origin` is this tab's client id is our own echo: ignored (our response already applied it).
 */
export function createStream(options: StreamOptions, handlers: StreamHandlers) {
  const create =
    options.create ?? ((url: string) => new EventSource(url) as unknown as EventSourceLike);
  const schedule = options.schedule ?? defaultSchedule;
  let source: EventSourceLike | null = null;
  let cancelReopen: (() => void) | null = null;
  let stopped = false;

  const open = () => {
    if (stopped) return;
    const es = create(options.url);
    source = es;
    es.onopen = () => handlers.onConnection?.(true);
    es.onerror = () => {
      handlers.onConnection?.(false);
      // The browser retries on its own unless it closed the stream for good (HTTP error, wrong content type).
      if (es.readyState === CLOSED && !stopped) {
        es.close();
        cancelReopen = schedule(open, options.reopenMs ?? 5_000);
      }
    };
    es.addEventListener('hello', () => handlers.onRefetch());
    es.addEventListener('resync', () => handlers.onRefetch());
    es.addEventListener('events-changed', (e) => {
      let parsed: { data?: EventsChangedMessage; origin?: string | null };
      try {
        parsed = JSON.parse(e.data);
      } catch {
        return; // a garbled message must not kill the stream
      }
      if (!parsed.data || (parsed.origin && parsed.origin === options.clientId)) return;
      handlers.onChanged(parsed.data);
    });
  };

  open();
  return {
    close() {
      stopped = true;
      cancelReopen?.();
      source?.close();
    },
  };
}
