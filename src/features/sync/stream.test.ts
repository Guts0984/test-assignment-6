// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createStream, type EventSourceLike } from './stream';
import { fakeScheduler } from './testing';

type Listener = (e: { data: string; lastEventId?: string }) => void;
function fakeEventSource() {
  const sources: Array<
    EventSourceLike & { emit: (type: string, payload?: unknown) => void; closed: boolean }
  > = [];
  const create = (): EventSourceLike => {
    const listeners = new Map<string, Listener[]>();
    const es = {
      readyState: 0,
      onopen: null as ((e: unknown) => void) | null,
      onerror: null as ((e: unknown) => void) | null,
      closed: false,
      addEventListener: (type: string, l: Listener) =>
        void listeners.set(type, [...(listeners.get(type) ?? []), l]),
      close() {
        es.closed = true;
        es.readyState = 2;
      },
      emit(type: string, payload?: unknown) {
        if (type === 'open') es.onopen?.({});
        else if (type === 'error') es.onerror?.({});
        else for (const l of listeners.get(type) ?? []) l({ data: JSON.stringify(payload) });
      },
    };
    sources.push(es);
    return es;
  };
  return { create, sources };
}

const change = (title: string, origin: string | null = 'other-tab') => ({
  data: { changed: [{ id: 'e1', title }], deletedEventIds: [] },
  origin,
});

describe('stream client', () => {
  it("delivers other people's changes", () => {
    const fake = fakeEventSource();
    const got: unknown[] = [];
    createStream(
      { url: '/api/stream', clientId: 'me', create: fake.create },
      { onChanged: (m) => void got.push(m), onRefetch: () => {} },
    );
    fake.sources[0]!.emit('events-changed', change('hello'));
    expect(got).toEqual([{ changed: [{ id: 'e1', title: 'hello' }], deletedEventIds: [] }]);
  });

  it("skips the echo of its own change (same client id) but not anyone else's", () => {
    const fake = fakeEventSource();
    const got: string[] = [];
    createStream(
      { url: '/s', clientId: 'tab-1', create: fake.create },
      {
        onChanged: (m) => void got.push((m.changed[0] as { title: string }).title),
        onRefetch: () => {},
      },
    );
    const es = fake.sources[0]!;
    es.emit('events-changed', change('mine', 'tab-1'));
    es.emit('events-changed', change('theirs', 'tab-2'));
    es.emit('events-changed', change('anonymous', null));
    expect(got).toEqual(['theirs', 'anonymous']);
  });

  it('hello (fresh connection) and resync both ask for a refetch', () => {
    const fake = fakeEventSource();
    let refetches = 0;
    createStream(
      { url: '/s', clientId: 'me', create: fake.create },
      { onChanged: () => {}, onRefetch: () => void (refetches += 1) },
    );
    fake.sources[0]!.emit('hello', {});
    fake.sources[0]!.emit('resync', {});
    expect(refetches).toBe(2);
  });

  it('a garbled message is ignored and later ones still work', () => {
    const fake = fakeEventSource();
    const got: unknown[] = [];
    const s = createStream(
      { url: '/s', clientId: 'me', create: fake.create },
      { onChanged: (m) => void got.push(m), onRefetch: () => {} },
    );
    const es = fake.sources[0]!;
    // emit raw non-JSON through the listener by hand:
    (es as unknown as { emit: (t: string, p?: unknown) => void }).emit('events-changed', undefined);
    es.emit('events-changed', { data: null, origin: null });
    es.emit('events-changed', change('ok'));
    expect(got).toHaveLength(1);
    s.close();
  });

  it('reports connection state', () => {
    const fake = fakeEventSource();
    const states: boolean[] = [];
    createStream(
      { url: '/s', clientId: 'me', create: fake.create },
      { onChanged: () => {}, onRefetch: () => {}, onConnection: (c) => void states.push(c) },
    );
    fake.sources[0]!.emit('open');
    fake.sources[0]!.emit('error');
    fake.sources[0]!.readyState = 0; // the browser is retrying by itself
    fake.sources[0]!.emit('open');
    expect(states).toEqual([true, false, true]);
  });

  it('while the browser is still retrying by itself, it does NOT open a second connection', () => {
    const fake = fakeEventSource();
    const time = fakeScheduler();
    createStream(
      { url: '/s', clientId: 'me', create: fake.create, schedule: time.schedule },
      { onChanged: () => {}, onRefetch: () => {} },
    );
    fake.sources[0]!.readyState = 0;
    fake.sources[0]!.emit('error');
    expect(fake.sources).toHaveLength(1);
    expect(time.pending()).toEqual([]);
  });

  it('if the browser gave up (stream CLOSED, e.g. after a 401), it reopens after a delay, and only once', async () => {
    const fake = fakeEventSource();
    const time = fakeScheduler();
    createStream(
      { url: '/s', clientId: 'me', create: fake.create, schedule: time.schedule, reopenMs: 3000 },
      { onChanged: () => {}, onRefetch: () => {} },
    );
    fake.sources[0]!.readyState = 2;
    fake.sources[0]!.emit('error');
    expect(fake.sources).toHaveLength(1);
    expect(time.pending()).toEqual([3000]);
    await time.advance(3000);
    expect(fake.sources).toHaveLength(2);
    expect(fake.sources[0]!.closed).toBe(true);
  });

  it('close() stops everything: no more events, no reopen', async () => {
    const fake = fakeEventSource();
    const time = fakeScheduler();
    const got: unknown[] = [];
    const s = createStream(
      { url: '/s', clientId: 'me', create: fake.create, schedule: time.schedule },
      { onChanged: (m) => void got.push(m), onRefetch: () => {} },
    );
    fake.sources[0]!.readyState = 2;
    fake.sources[0]!.emit('error'); // schedules a reopen
    s.close();
    await time.advance(60_000);
    expect(fake.sources).toHaveLength(1);
    expect(time.pending()).toEqual([]);
  });
});
