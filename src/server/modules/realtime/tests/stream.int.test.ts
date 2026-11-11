import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it } from 'vitest';
import { createBus, getBus, type Bus } from '@/server/modules/realtime';
import { makeStreamHandler } from '@/server/modules/realtime/http';
import {
  ctxOf,
  deps,
  reply,
  req,
  setupApiWorld,
  tokens,
  world,
  type Who,
} from '@/server/tools/testing/harness';
import {
  makeCreateEventHandler,
  makeDeleteEventHandler,
  makeUpdateEventHandler,
} from '@/server/modules/events/http';

setupApiWorld();

type Frame = { id?: string; event?: string; data?: any; comment?: string; retry?: string }; // eslint-disable-line @typescript-eslint/no-explicit-any -- parsed JSON

/** A tiny EventSource: opens the stream through the real handler and parses frames as they arrive. */
async function connect(
  who: Who,
  opts: { lastEventId?: string; bus?: Bus; heartbeatMs?: number; maxBacklog?: number } = {},
) {
  const abort = new AbortController();
  const handler = makeStreamHandler({
    auth: deps(),
    bus: () => opts.bus ?? getBus(),
    heartbeatMs: opts.heartbeatMs ?? 60_000,
    maxBacklog: opts.maxBacklog,
  });
  const request = new NextRequest('http://localhost:3000/api/stream', {
    headers: {
      host: 'localhost:3000',
      ...(who !== 'none' ? { cookie: `session=${tokens[who]}` } : {}),
      ...(opts.lastEventId ? { 'last-event-id': opts.lastEventId } : {}),
    },
    signal: abort.signal,
  });
  const response = await handler(request);
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let ended = false;

  const parse = (block: string): Frame => {
    const f: Frame = {};
    for (const line of block.split('\n')) {
      if (line.startsWith(':')) f.comment = line.slice(1).trim();
      else if (line.startsWith('id: ')) f.id = line.slice(4);
      else if (line.startsWith('event: ')) f.event = line.slice(7);
      else if (line.startsWith('data: ')) f.data = JSON.parse(line.slice(6));
      else if (line.startsWith('retry: ')) f.retry = line.slice(7);
    }
    return f;
  };

  /** Next `n` frames; fails (instead of hanging) if they do not arrive in time. */
  const next = async (n = 1, timeoutMs = 2000): Promise<Frame[]> => {
    const frames: Frame[] = [];
    const deadline = Date.now() + timeoutMs;
    while (frames.length < n) {
      const cut = pending.indexOf('\n\n');
      if (cut !== -1) {
        frames.push(parse(pending.slice(0, cut)));
        pending = pending.slice(cut + 2);
        continue;
      }
      if (ended || !reader) throw new Error(`stream ended after ${frames.length}/${n} frames`);
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`timed out waiting for frame ${frames.length + 1}/${n}`);
      const chunk = await Promise.race([
        reader.read(),
        new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), left)),
      ]);
      if (chunk === 'timeout')
        throw new Error(`timed out waiting for frame ${frames.length + 1}/${n}`);
      if (chunk.done) ended = true;
      else pending += decoder.decode(chunk.value);
    }
    return frames;
  };
  /** Next non-control frame (skips retry/hello). */
  const nextEvent = async (): Promise<Frame> => {
    for (;;) {
      const [f] = await next();
      if (f && f.event && f.event !== 'hello') return f;
    }
  };
  const isOver = async (timeoutMs = 1000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (ended) return true;
      const chunk = await Promise.race([
        reader!.read(),
        new Promise<'t'>((r) => setTimeout(() => r('t'), 50)),
      ]);
      if (chunk !== 't') {
        if (chunk.done) ended = true;
        else pending += decoder.decode(chunk.value);
      }
    }
    return ended;
  };
  const close = () => abort.abort();
  opened.push(close);
  return { response, next, nextEvent, isOver, close, abort, reader };
}
const opened: Array<() => void> = [];
afterEach(() => {
  for (const close of opened.splice(0)) close();
});

const create = makeCreateEventHandler(deps());
const update = makeUpdateEventHandler(deps());
const remove = makeDeleteEventHandler(deps());
const meeting = (over: Record<string, unknown> = {}) => ({
  roomId: world.roomA,
  title: 'Live',
  startAt: '2026-12-01T10:00:00Z',
  endAt: '2026-12-01T11:00:00Z',
  ...over,
});
const post = (who: Who, body: unknown, clientId?: string) => {
  const r = req('POST', '/api/events', who, body);
  if (clientId) r.headers.set('x-client-id', clientId);
  return create(r).then(reply);
};
const waitFor = async (cond: () => boolean, ms = 1000) => {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await new Promise((r) => setTimeout(r, 10));
  return cond();
};

describe('GET /api/stream', () => {
  it('needs a session', async () => {
    const r = await connect('none');
    expect(r.response.status).toBe(401);
  });

  it('opens an event stream that is not cached or buffered, and greets a fresh client with hello + current id', async () => {
    const s = await connect('ana');
    expect(s.response.status).toBe(200);
    expect(s.response.headers.get('content-type')).toMatch(/^text\/event-stream/);
    expect(s.response.headers.get('cache-control')).toMatch(/no-cache/);
    expect(s.response.headers.get('x-accel-buffering')).toBe('no');
    const [retry, hello] = await s.next(2);
    expect(retry?.retry).toBe('2000');
    expect(hello).toMatchObject({ event: 'hello', id: getBus().latestId() });
  });

  it("creating, editing and deleting an event reaches ANOTHER user live, in order, without the author's client id", async () => {
    const bob = await connect('bob');
    await bob.next(2); // retry + hello
    const made = await post('ana', meeting(), 'ana-tab-1');
    expect(made.status).toBe(201);
    const id = made.body.events[0].id;

    const f1 = await bob.nextEvent();
    expect(f1.event).toBe('events-changed');
    // The client id is a capability ("ignore messages with this id"): other users never see it.
    expect(f1.data.origin).toBeNull();
    expect(f1.data.data.changed[0]).toMatchObject({ id, title: 'Live', version: 1 });

    const edited = await update(
      Object.assign(req('PATCH', `/api/events/${id}`, 'ana', { version: 1, title: 'Renamed' }), {}),
      ctxOf(id),
    ).then(reply);
    expect(edited.status).toBe(200);
    const f2 = await bob.nextEvent();
    expect(f2.data.data.changed[0]).toMatchObject({ id, title: 'Renamed', version: 2 });

    const removed = await remove(
      req('DELETE', `/api/events/${id}?version=2`, 'ana'),
      ctxOf(id),
    ).then(reply);
    expect(removed.status).toBe(200);
    const f3 = await bob.nextEvent();
    expect(f3.data.data).toEqual({ changed: [], deletedEventIds: [id] });

    const seq = [f1, f2, f3].map((f) => Number(f.id!.split(':')[1]));
    expect(seq).toEqual([seq[0]!, seq[0]! + 1, seq[0]! + 2]);
  });

  it("the author's own connection sees the client id (to skip its own echo), nobody else's does", async () => {
    const ana = await connect('ana');
    await ana.next(2);
    const bob = await connect('bob');
    await bob.next(2);
    await post('ana', meeting(), 'ana-tab-1');
    const mine = await ana.nextEvent();
    const theirs = await bob.nextEvent();
    expect(mine.data.origin).toBe('ana-tab-1');
    expect(theirs.data.origin).toBeNull();
  });

  it('a series edit publishes every event it touched (old series, new series)', async () => {
    const bob = await connect('bob');
    await bob.next(2);
    const series = await post('ana', meeting({ rrule: 'FREQ=DAILY;COUNT=5' }));
    await bob.nextEvent();
    const id = series.body.events[0].id;
    await update(
      req('PATCH', `/api/events/${id}`, 'ana', {
        version: 1,
        scope: 'following',
        occurrenceStart: '2026-12-03T10:00:00Z',
        title: 'Rest',
      }),
      ctxOf(id),
    );
    const f = await bob.nextEvent();
    expect(f.data.data.changed.map((e: { title: string }) => e.title)).toEqual(['Live', 'Rest']);
  });

  it('FAILED mutations publish NOTHING (no ghost updates)', async () => {
    const bob = await connect('bob');
    await bob.next(2);
    const before = getBus().latestId();
    await post('ana', meeting({ endAt: '2026-12-01T09:00:00Z' })); // 400
    await post('ana', meeting()); // ok -> 1 message
    const conflict = await post('bob', meeting()); // 409
    expect(conflict.status).toBe(409);
    const stale = await update(
      req('PATCH', `/api/events/${'00000000-0000-4000-8000-000000000000'}`, 'ana', {
        version: 1,
        title: 'x',
      }),
      ctxOf('00000000-0000-4000-8000-000000000000'),
    );
    expect(stale.status).toBe(404);
    const only = await bob.nextEvent();
    expect(only.data.data.changed[0].title).toBe('Live');
    expect(Number(getBus().latestId().split(':')[1]) - Number(before.split(':')[1])).toBe(1);
    await expect(bob.next(1, 150)).rejects.toThrow(/timed out/); // nothing else queued
  });

  it('sanitizes the X-Client-Id header: junk becomes no origin', async () => {
    const bob = await connect('bob');
    await bob.next(2);
    await post('ana', meeting({ title: 'A' }), 'x'.repeat(65));
    expect((await bob.nextEvent()).data.origin).toBeNull();
    await post(
      'ana',
      meeting({ title: 'B', startAt: '2026-12-02T10:00:00Z', endAt: '2026-12-02T11:00:00Z' }),
      'bad id!',
    );
    expect((await bob.nextEvent()).data.origin).toBeNull();
  });

  it('every subscriber gets each message exactly once', async () => {
    const clients = await Promise.all([connect('ana'), connect('bob'), connect('bob')]);
    await Promise.all(clients.map((c) => c.next(2)));
    await post('ana', meeting());
    const got = await Promise.all(clients.map((c) => c.nextEvent()));
    expect(new Set(got.map((f) => f.id)).size).toBe(1);
    for (const c of clients) await expect(c.next(1, 100)).rejects.toThrow(/timed out/);
  });
});

describe('reconnect and replay', () => {
  it('Last-Event-ID replays exactly the missed messages, no hello, no duplicates', async () => {
    const first = await connect('bob');
    await first.next(2);
    await post('ana', meeting({ title: 'm1' }));
    const m1 = await first.nextEvent();
    first.close(); // Bob goes offline
    await post(
      'ana',
      meeting({ title: 'm2', startAt: '2026-12-02T10:00:00Z', endAt: '2026-12-02T11:00:00Z' }),
    );
    await post(
      'ana',
      meeting({ title: 'm3', startAt: '2026-12-03T10:00:00Z', endAt: '2026-12-03T11:00:00Z' }),
    );

    const again = await connect('bob', { lastEventId: m1.id });
    const [retry, a, b] = await again.next(3);
    expect(retry?.retry).toBe('2000');
    expect([a, b].map((f) => f?.data.data.changed[0].title)).toEqual(['m2', 'm3']);
    await post(
      'ana',
      meeting({ title: 'm4', startAt: '2026-12-04T10:00:00Z', endAt: '2026-12-04T11:00:00Z' }),
    );
    expect((await again.nextEvent()).data.data.changed[0].title).toBe('m4'); // live continues, m2/m3 not repeated
  });

  it('an up-to-date client gets nothing replayed', async () => {
    await post('ana', meeting());
    const s = await connect('bob', { lastEventId: getBus().latestId() });
    await s.next(1); // retry only
    await expect(s.next(1, 150)).rejects.toThrow(/timed out/);
  });

  it('asks for a resync for an id from another server run, a malformed id, or an evicted gap', async () => {
    const stale = await connect('bob', { lastEventId: 'oldserver:5' });
    const [, resync] = await stale.next(2);
    expect(resync).toMatchObject({ event: 'resync', id: getBus().latestId() });

    const junk = await connect('bob', { lastEventId: 'not-an-id' });
    expect((await junk.next(2))[1]?.event).toBe('resync');

    const small = createBus({ capacity: 2 });
    const first = small.publish('t', 1, null);
    small.publish('t', 2, null);
    small.publish('t', 3, null);
    small.publish('t', 4, null);
    const gap = await connect('bob', { bus: small, lastEventId: first.id });
    expect((await gap.next(2))[1]?.event).toBe('resync');
  });
});

describe('connection lifecycle', () => {
  it('unsubscribes when the client disconnects (abort) or cancels the reader: no leaks', async () => {
    const bus = createBus();
    const a = await connect('ana', { bus });
    const b = await connect('bob', { bus });
    await a.next(2);
    await b.next(2);
    expect(bus.subscriberCount()).toBe(2);
    a.abort.abort();
    expect(await waitFor(() => bus.subscriberCount() === 1)).toBe(true);
    await b.reader!.cancel();
    expect(await waitFor(() => bus.subscriberCount() === 0)).toBe(true);
  });

  it('sends heartbeat comments on an idle connection', async () => {
    const s = await connect('ana', { heartbeatMs: 20 });
    const frames = await s.next(4);
    expect(frames.filter((f) => f.comment === 'ping').length).toBeGreaterThanOrEqual(2);
  });

  it('stops heartbeating after disconnect (no timer leak)', async () => {
    const bus = createBus();
    const s = await connect('ana', { bus, heartbeatMs: 10 });
    await s.next(2);
    s.abort.abort();
    expect(await waitFor(() => bus.subscriberCount() === 0)).toBe(true);
  });

  it('cuts off a client that does not read, instead of buffering forever', async () => {
    const bus = createBus();
    const slow = await connect('ana', { bus, maxBacklog: 3 });
    await slow.next(1);
    for (let i = 0; i < 50; i += 1) bus.publish('t', { i }, null); // nobody reads
    expect(await waitFor(() => bus.subscriberCount() === 0)).toBe(true);
    expect(await slow.isOver()).toBe(true); // stream ends; EventSource would reconnect with Last-Event-ID
  });

  it('one slow client does not starve a healthy one', async () => {
    const bus = createBus();
    const slow = await connect('ana', { bus, maxBacklog: 2 });
    const healthy = await connect('bob', { bus });
    await healthy.next(2);
    for (let i = 0; i < 30; i += 1) bus.publish('t', { i }, null);
    const got: number[] = [];
    for (let i = 0; i < 30; i += 1) got.push((await healthy.nextEvent()).data.data.i);
    expect(got).toEqual(Array.from({ length: 30 }, (_, i) => i));
    void slow;
  });
});
