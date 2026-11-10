import type { NextRequest, NextResponse } from 'next/server';
import { authorize, isDenied, type AuthDeps } from '@/server/modules/auth/http';
import type { Bus } from '../bus';
import { formatControl, formatMessage, formatPing, formatRetry } from '../sse';

export type StreamDeps = {
  auth: AuthDeps;
  bus: () => Bus;
  heartbeatMs: number;
  /** A client this far behind (unread chunks) is cut off; it reconnects and replays or resyncs. */
  maxBacklog?: number;
};

const encoder = new TextEncoder();

/**
 * `GET /api/stream`: Server-Sent Events of everything that changes.
 * Reconnecting clients send `Last-Event-ID` and get what they missed (or a `resync` request).
 */
export const makeStreamHandler =
  (deps: StreamDeps) =>
  async (req: NextRequest): Promise<NextResponse | Response> => {
    const ctx = await authorize(deps.auth, req, { mutating: false });
    if (isDenied(ctx)) return ctx;

    const bus = deps.bus();
    const maxBacklog = deps.maxBacklog ?? 100;
    const lastEventId = req.headers.get('last-event-id') ?? undefined;
    let cleanup = () => {};

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;
        const send = (text: string) => {
          if (closed) return;
          controller.enqueue(encoder.encode(text));
          if ((controller.desiredSize ?? 1) < -maxBacklog) close(); // reader is not keeping up
        };
        const close = () => {
          if (closed) return;
          closed = true;
          cleanup();
          try {
            controller.close();
          } catch {
            /* already closed by the reader */
          }
        };

        send(formatRetry(2000));
        // Subscribe BEFORE replaying so nothing published in between is lost; duplicates are
        // filtered by sequence below.
        const queue: string[] = [];
        let replaying = true;
        const seen = new Set<string>();
        const unsubscribe = bus.subscribe((m) => {
          if (seen.has(m.id)) return;
          seen.add(m.id);
          if (replaying) queue.push(formatMessage(m));
          else send(formatMessage(m));
        });

        const replay = bus.replay(lastEventId);
        if (lastEventId === undefined) send(formatControl('hello', bus.latestId()));
        else if (replay.kind === 'resync') send(formatControl('resync', bus.latestId()));
        else
          for (const m of replay.messages) {
            if (seen.has(m.id)) continue;
            seen.add(m.id);
            send(formatMessage(m));
          }
        replaying = false;
        for (const text of queue) send(text);

        const heartbeat = setInterval(() => send(formatPing()), deps.heartbeatMs);
        cleanup = () => {
          clearInterval(heartbeat);
          unsubscribe();
        };
        req.signal.addEventListener('abort', close);
      },
      cancel() {
        cleanup();
      },
    });

    return new Response(stream, {
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      },
    });
  };
