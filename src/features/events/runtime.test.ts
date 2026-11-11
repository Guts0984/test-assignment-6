// @vitest-environment node
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { CalEvent } from '@/shared/calendar';
import type { EventDto } from '@/shared/contracts';
import { fakeScheduler, fakeServer, memoryStorage } from '@/features/sync/testing';
import { parseInstant } from '@/shared/zoned';
import { occurrenceOf, type Period } from './cache';
import { allPeriods } from './cache-ops';
import { HISTORY_LIMIT } from './history';
import { keys } from './queries';
import { createEventsRuntime, type Notice } from './runtime';

const FROM = parseInstant('2026-12-01T00:00:00Z')!;
const TO = parseInstant('2026-12-08T00:00:00Z')!;
const iso = (h: number, d = 1) =>
  `2026-12-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:00:00Z`;

function setup() {
  const server = fakeServer();
  const client = new QueryClient();
  const storage = memoryStorage();
  const time = fakeScheduler();
  const notices: Notice[] = [];
  const announced: string[] = [];
  let gate: Promise<void> | null = null;
  const inner = server.transport.send;
  server.transport.send = async (c, v) => {
    if (gate) await gate;
    return inner(c, v);
  };
  const runtime = createEventsRuntime({
    client,
    storage,
    transport: server.transport,
    me: { id: 'u1', name: 'Ana' },
    userName: (id) => (id === 'u2' ? 'Bob' : 'Someone'),
    notifier: {
      notify: (n) => void notices.push(n),
      announce: (code) => void announced.push(code),
    },
    schedule: time.schedule,
  });
  const seedEvent = (id: string, startH: number, endH: number, over: Partial<EventDto> = {}) => {
    server.seed(id, 1, { startAt: iso(startH), endAt: iso(endH), ...over });
    show();
    return id;
  };
  const show = () => {
    const events = [...server.events.values()].map((d) =>
      occurrenceOf(d, d.creatorId === 'u1' ? 'Ana' : 'Bob'),
    );
    client.setQueryData<Period>(keys.period(FROM, TO), { from: FROM, to: TO, events });
  };
  const screen = () =>
    (allPeriods(client)[0]?.[1].events ?? [])
      .map((e) => ({
        id: e.eventId,
        start: e.start,
        end: e.end,
        room: e.roomId,
        title: e.title,
        sync: e.sync,
      }))
      .sort((a, b) => (a.id < b.id ? -1 : 1));
  const serverView = () =>
    [...server.events.values()]
      .map((d) => ({
        id: d.id,
        start: parseInstant(d.startAt)!,
        end: parseInstant(d.endAt)!,
        room: d.roomId,
        title: d.title,
      }))
      .sort((a, b) => (a.id < b.id ? -1 : 1));
  const stripSync = () =>
    screen().map((e) => ({ id: e.id, start: e.start, end: e.end, room: e.room, title: e.title }));
  const expectInSync = () => expect(stripSync()).toEqual(serverView());
  const event = (id: string): CalEvent =>
    allPeriods(client)[0]![1].events.find((e) => e.eventId === id)!;
  const hold = () => {
    let release = () => {};
    gate = new Promise<void>(
      (r) =>
        (release = () => {
          gate = null;
          r();
        }),
    );
    return release;
  };
  show(); // an (empty) period must exist, as it always does in the app
  return {
    server,
    client,
    storage,
    time,
    runtime,
    notices,
    announced,
    seedEvent,
    screen,
    stripSync,
    serverView,
    expectInSync,
    event,
    hold,
    show,
  };
}

describe('optimistic changes', () => {
  it('a move shows instantly (marked syncing), then settles; the server agrees', async () => {
    const h = setup();
    h.seedEvent('a', 9, 10);
    const release = h.hold();
    h.runtime.actions.change(h.event('a'), {
      start: parseInstant(iso(14))!,
      end: parseInstant(iso(15))!,
    });
    expect(h.screen()[0]).toMatchObject({ start: parseInstant(iso(14)), sync: 'syncing' }); // before the server answered
    expect(h.server.events.get('a')?.startAt).toBe(iso(9));
    release();
    await h.runtime.engine.whenIdle();
    expect(h.screen()[0]?.sync).toBeUndefined();
    h.expectInSync();
    expect(h.event('a').version).toBe(2);
  });

  it('create shows the new event at once and keeps the id the server will use', async () => {
    const h = setup();
    const release = h.hold();
    const id = h.runtime.actions.create({
      roomId: 'room-1',
      title: 'New',
      start: parseInstant(iso(9))!,
      end: parseInstant(iso(10))!,
      tzid: 'UTC',
    });
    expect(h.screen()).toMatchObject([{ id, title: 'New', sync: 'syncing' }]);
    release();
    await h.runtime.engine.whenIdle();
    expect(h.server.events.has(id)).toBe(true);
    h.expectInSync();
  });

  it('delete removes the event at once', async () => {
    const h = setup();
    h.seedEvent('a', 9, 10);
    const release = h.hold();
    h.runtime.actions.remove(h.event('a'));
    expect(h.screen()).toEqual([]);
    release();
    await h.runtime.engine.whenIdle();
    expect(h.server.events.size).toBe(0);
  });

  it('resize changes only the end', async () => {
    const h = setup();
    h.seedEvent('a', 9, 10);
    const e = h.event('a');
    h.runtime.actions.change(e, { start: e.start, end: parseInstant(iso(12))! });
    await h.runtime.engine.whenIdle();
    expect(h.server.events.get('a')).toMatchObject({ startAt: iso(9), endAt: iso(12) });
    expect(h.announced).toContain('resized');
    h.expectInSync();
  });
});

describe('server refusals roll back and explain (acceptance #7)', () => {
  it('a room conflict puts the event back and names who is in the way', async () => {
    const h = setup();
    h.seedEvent('a', 9, 10);
    const orig = h.server.transport.send;
    h.server.transport.send = async (c, v) =>
      c.kind === 'update'
        ? {
            type: 'room-conflict',
            blockers: [
              {
                eventId: 'x',
                title: 'Board meeting',
                creator: { id: 'u2', name: 'Bob' },
                start: iso(14),
                end: iso(15),
              },
            ],
          }
        : orig(c, v);
    h.runtime.actions.change(h.event('a'), {
      start: parseInstant(iso(14))!,
      end: parseInstant(iso(15))!,
    });
    expect(h.screen()[0]?.start).toBe(parseInstant(iso(14))); // optimistic
    await h.runtime.engine.whenIdle();
    expect(h.screen()[0]).toMatchObject({ start: parseInstant(iso(9)), sync: undefined }); // rolled back
    expect(h.notices).toHaveLength(1);
    expect(h.notices[0]).toMatchObject({
      kind: 'error',
      code: 'ROOM_CONFLICT',
      params: { title: 'Board meeting', creator: 'Bob' },
    });
    expect(h.runtime.history.get().past).toEqual([]); // a refused action is not in the undo history
  });

  it('a refused create disappears again', async () => {
    const h = setup();
    h.server.transport.send = async () => ({ type: 'room-conflict', blockers: [] });
    h.runtime.actions.create({
      roomId: 'room-1',
      title: 'Nope',
      start: parseInstant(iso(9))!,
      end: parseInstant(iso(10))!,
      tzid: 'UTC',
    });
    await h.runtime.engine.whenIdle();
    expect(h.screen()).toEqual([]);
    expect(h.notices[0]).toMatchObject({ code: 'ROOM_CONFLICT_GENERIC' });
  });

  it('a version conflict (someone else edited first): rollback to THEIR version, with an explanation', async () => {
    const h = setup();
    h.seedEvent('a', 9, 10);
    h.server.editBySomeoneElse('a', { title: 'Their title' }); // server v2; the screen still shows v1
    h.runtime.actions.change(h.event('a'), { title: 'My title' });
    await h.runtime.engine.whenIdle();
    expect(h.screen()[0]).toMatchObject({ title: 'Their title' });
    expect(h.notices[0]).toMatchObject({ code: 'VERSION_CONFLICT' });
    h.expectInSync();
  });
});

describe('undo / redo keep the server and the screen in step (acceptance #8)', () => {
  it('undo after a move: back where it was on the screen AND on the server; redo moves it again', async () => {
    const h = setup();
    h.seedEvent('a', 9, 10);
    h.runtime.actions.change(h.event('a'), {
      start: parseInstant(iso(14))!,
      end: parseInstant(iso(15))!,
    });
    await h.runtime.engine.whenIdle();
    h.runtime.actions.undo();
    await h.runtime.engine.whenIdle();
    expect(h.server.events.get('a')).toMatchObject({ startAt: iso(9), endAt: iso(10) });
    h.expectInSync();
    h.runtime.actions.redo();
    await h.runtime.engine.whenIdle();
    expect(h.server.events.get('a')).toMatchObject({ startAt: iso(14), endAt: iso(15) });
    h.expectInSync();
  });

  it('undo after a delete brings the SAME event back (same id) on the server and the screen', async () => {
    const h = setup();
    h.seedEvent('a', 9, 10, { title: 'Precious', attendeeIds: ['u2'] });
    const snapshot = h.server.events.get('a')!;
    h.runtime.actions.remove(h.event('a'), undefined, snapshot);
    await h.runtime.engine.whenIdle();
    expect(h.server.events.size).toBe(0);
    h.runtime.actions.undo();
    expect(h.screen()).toMatchObject([{ id: 'a', title: 'Precious' }]); // instantly
    await h.runtime.engine.whenIdle();
    expect(h.server.events.get('a')).toMatchObject({ title: 'Precious' });
    h.expectInSync();
    h.runtime.actions.redo();
    await h.runtime.engine.whenIdle();
    expect(h.server.events.size).toBe(0);
  });

  it('undo after a resize restores the old duration', async () => {
    const h = setup();
    h.seedEvent('a', 9, 10);
    const e = h.event('a');
    h.runtime.actions.change(e, { start: e.start, end: parseInstant(iso(12))! });
    await h.runtime.engine.whenIdle();
    h.runtime.actions.undo();
    await h.runtime.engine.whenIdle();
    expect(h.server.events.get('a')?.endAt).toBe(iso(10));
    h.expectInSync();
  });

  it('undo of a create deletes it; redo creates it again with the same id', async () => {
    const h = setup();
    const id = h.runtime.actions.create({
      roomId: 'room-1',
      title: 'New',
      start: parseInstant(iso(9))!,
      end: parseInstant(iso(10))!,
      tzid: 'UTC',
    });
    await h.runtime.engine.whenIdle();
    h.runtime.actions.undo();
    await h.runtime.engine.whenIdle();
    expect(h.server.events.size).toBe(0);
    expect(h.screen()).toEqual([]);
    h.runtime.actions.redo();
    await h.runtime.engine.whenIdle();
    expect([...h.server.events.keys()]).toEqual([id]);
    h.expectInSync();
  });

  it('undo uses the CURRENT version, so it works after the event was changed again in between', async () => {
    const h = setup();
    h.seedEvent('a', 9, 10);
    h.runtime.actions.change(h.event('a'), { title: 'one' });
    await h.runtime.engine.whenIdle();
    h.runtime.actions.change(h.event('a'), { title: 'two' });
    await h.runtime.engine.whenIdle();
    h.runtime.actions.undo();
    h.runtime.actions.undo();
    await h.runtime.engine.whenIdle();
    expect(h.server.events.get('a')).toMatchObject({ title: 'T', version: 5 });
    h.expectInSync();
    expect(h.notices).toEqual([]);
  });

  it('only the last 20 actions can be undone', async () => {
    const h = setup();
    h.seedEvent('a', 9, 10);
    for (let i = 1; i <= 25; i += 1) {
      h.runtime.actions.change(h.event('a'), { title: `title ${i}` });
      await h.runtime.engine.whenIdle();
    }
    for (let i = 0; i < 30; i += 1) h.runtime.actions.undo();
    await h.runtime.engine.whenIdle();
    expect(h.server.events.get('a')?.title).toBe('title 5'); // 25 - 20: the first 5 are not undoable
    expect(HISTORY_LIMIT).toBe(20);
    h.expectInSync();
  });

  it('a new action after undo clears redo', async () => {
    const h = setup();
    h.seedEvent('a', 9, 10);
    h.runtime.actions.change(h.event('a'), { title: 'one' });
    await h.runtime.engine.whenIdle();
    h.runtime.actions.undo();
    await h.runtime.engine.whenIdle();
    h.runtime.actions.change(h.event('a'), { title: 'two' });
    await h.runtime.engine.whenIdle();
    h.runtime.actions.redo(); // nothing to redo
    await h.runtime.engine.whenIdle();
    expect(h.server.events.get('a')?.title).toBe('two');
  });

  it('undo offline is queued and synced later, like any change', async () => {
    const h = setup();
    h.seedEvent('a', 9, 10);
    h.runtime.actions.change(h.event('a'), { title: 'one' });
    await h.runtime.engine.whenIdle();
    h.runtime.engine.setOnline(false);
    h.runtime.actions.undo();
    expect(h.screen()[0]?.title).toBe('T'); // visible at once
    expect(h.server.events.get('a')?.title).toBe('one'); // not yet on the server
    h.runtime.engine.setOnline(true);
    await h.runtime.engine.whenIdle();
    h.expectInSync();
  });
});

describe('rapid actions never desynchronize (assignment §3)', () => {
  it('three quick moves of one event: all shown in order, the server ends where the screen ends, no errors', async () => {
    const h = setup();
    h.seedEvent('a', 9, 10);
    const release = h.hold();
    const hours = [11, 13, 16];
    for (const hr of hours)
      h.runtime.actions.change(h.event('a'), {
        start: parseInstant(iso(hr))!,
        end: parseInstant(iso(hr + 1))!,
      });
    expect(h.screen()[0]?.start).toBe(parseInstant(iso(16)));
    release();
    await h.runtime.engine.whenIdle();
    expect(h.notices).toEqual([]);
    expect(h.server.events.get('a')).toMatchObject({ startAt: iso(16), version: 4 });
    h.expectInSync();
  });

  it('a double-clicked delete is not an error', async () => {
    const h = setup();
    h.seedEvent('a', 9, 10);
    const e = h.event('a');
    h.runtime.actions.remove(e);
    h.runtime.actions.remove(e);
    await h.runtime.engine.whenIdle();
    expect(h.notices).toEqual([]);
    expect(h.server.events.size).toBe(0);
  });

  it('moving an event while its previous move is still in flight uses the chained version', async () => {
    const h = setup();
    h.seedEvent('a', 9, 10);
    const release = h.hold();
    h.runtime.actions.change(h.event('a'), {
      start: parseInstant(iso(11))!,
      end: parseInstant(iso(12))!,
    });
    h.runtime.actions.change(h.event('a'), { title: 'renamed meanwhile' });
    release();
    await h.runtime.engine.whenIdle();
    expect(h.server.events.get('a')).toMatchObject({
      startAt: iso(11),
      title: 'renamed meanwhile',
    });
    expect(h.notices).toEqual([]);
  });
});

describe('offline (acceptance #9)', () => {
  it('5 changes offline show immediately, wait, then all reach the server in order', async () => {
    const h = setup();
    for (const [id, s] of [
      ['a', 8],
      ['b', 10],
      ['c', 12],
    ] as const)
      h.seedEvent(id, s, s + 1);
    h.runtime.engine.setOnline(false);
    h.runtime.actions.change(h.event('a'), { title: 'A2' });
    h.runtime.actions.change(h.event('b'), {
      start: parseInstant(iso(15))!,
      end: parseInstant(iso(16))!,
    });
    h.runtime.actions.remove(h.event('c'));
    const newId = h.runtime.actions.create({
      roomId: 'room-1',
      title: 'D',
      start: parseInstant(iso(17))!,
      end: parseInstant(iso(18))!,
      tzid: 'UTC',
    });
    h.runtime.actions.change(h.event('a'), { title: 'A3' });
    expect(h.runtime.engine.getState()).toMatchObject({ status: 'offline', pending: 5 });
    expect(
      h
        .screen()
        .map((e) => e.id)
        .sort(),
    ).toEqual(['a', 'b', newId].sort());
    expect(h.server.sends()).toBe(0);

    h.runtime.engine.setOnline(true);
    await h.runtime.engine.whenIdle();
    expect(h.server.applied.map((a) => a.kind)).toEqual([
      'update',
      'update',
      'delete',
      'create',
      'update',
    ]);
    expect(h.server.events.get('a')?.title).toBe('A3');
    h.expectInSync();
  });

  it('after a reload the queued changes are drawn again over fresh (older) server data, and then sent', async () => {
    const first = setup();
    first.seedEvent('a', 9, 10);
    first.runtime.engine.setOnline(false);
    first.runtime.actions.change(first.event('a'), {
      start: parseInstant(iso(14))!,
      end: parseInstant(iso(15))!,
    });
    first.seedEvent('b', 11, 12);
    first.runtime.actions.remove(first.event('b'));

    // --- reload: new client + runtime, same IndexedDB, server data is the old state ---
    const server = first.server;
    const client = new QueryClient();
    const time = fakeScheduler();
    const runtime = createEventsRuntime({
      client,
      storage: first.storage,
      transport: server.transport,
      me: { id: 'u1', name: 'Ana' },
      userName: () => 'x',
      notifier: { notify: () => {}, announce: () => {} },
      schedule: time.schedule,
    });
    runtime.engine.setOnline(false);
    await runtime.engine.start();
    // the page fetches the period from the server, which has not seen the changes yet:
    const fresh: Period = {
      from: FROM,
      to: TO,
      events: [...server.events.values()].map((d) => occurrenceOf(d, 'Ana')),
    };
    const shown = runtime.overlay(fresh);
    expect(shown.events.map((e) => [e.eventId, e.start])).toEqual([['a', parseInstant(iso(14))]]); // moved a, deleted b
    expect(shown.events[0]?.sync).toBe('syncing');
    runtime.engine.setOnline(true);
    await runtime.engine.whenIdle();
    expect(server.events.get('a')?.startAt).toBe(iso(14));
    expect(server.events.has('b')).toBe(false);
  });
});

describe("other people's changes (SSE)", () => {
  it('appear without a reload', () => {
    const h = setup();
    h.seedEvent('a', 9, 10);
    h.runtime.applyRemote({
      changed: [{ ...h.server.events.get('a')!, title: 'by Bob', version: 2, creatorId: 'u2' }],
      deletedEventIds: [],
    });
    expect(h.screen()[0]).toMatchObject({ title: 'by Bob' });
    h.runtime.applyRemote({ changed: [], deletedEventIds: ['a'] });
    expect(h.screen()).toEqual([]);
  });

  it('are ignored for an event I still have unsent changes for (no flicker back to the older state)', async () => {
    const h = setup();
    h.seedEvent('a', 9, 10);
    const release = h.hold();
    h.runtime.actions.change(h.event('a'), { title: 'mine' });
    h.runtime.applyRemote({
      changed: [{ ...h.server.events.get('a')!, title: 'echo of an older state', version: 2 }],
      deletedEventIds: [],
    });
    expect(h.screen()[0]?.title).toBe('mine');
    release();
    await h.runtime.engine.whenIdle();
  });

  it('the echo of my OWN change over SSE changes nothing and does not touch the cache (no flicker)', async () => {
    const h = setup();
    h.seedEvent('a', 9, 10);
    h.runtime.actions.change(h.event('a'), { title: 'mine' });
    await h.runtime.engine.whenIdle();
    const writes = vi.spyOn(h.client, 'setQueryData');
    h.runtime.applyRemote({ changed: [h.server.events.get('a')!], deletedEventIds: [] }); // same version as shown
    expect(writes).not.toHaveBeenCalled();
    expect(h.screen()[0]?.title).toBe('mine');
  });
});

describe('series edits', () => {
  it('"only this" is undoable and undo targets the detached event the server created', async () => {
    const h = setup();
    h.seedEvent('s', 9, 10, { rrule: 'FREQ=DAILY;COUNT=3' });
    // The fake server does not model series: emulate the real answer to a scoped update.
    const orig = h.server.transport.send;
    h.server.transport.send = async (c, v) => {
      if (c.kind === 'update' && c.body.scope === 'this') {
        const master = h.server.events.get('s')!;
        const detached = {
          ...master,
          id: 'detached-1',
          rrule: null,
          seriesId: 's',
          originalStart: c.body.occurrenceStart ?? null,
          startAt: c.body.startAt!,
          endAt: c.body.endAt!,
          version: 1,
        };
        h.server.events.set('detached-1', detached);
        h.server.events.set('s', { ...master, version: master.version + 1 });
        return {
          type: 'ok',
          result: { events: [h.server.events.get('s')!, detached], deletedEventIds: [] },
        };
      }
      return orig(c, v);
    };
    h.show();
    h.runtime.actions.change(
      h.event('s'),
      { start: parseInstant(iso(14))!, end: parseInstant(iso(15))! },
      'this',
    );
    await h.runtime.engine.whenIdle();
    const entry = h.runtime.history.get().past[0];
    expect(entry?.undo).toMatchObject({
      kind: 'update',
      eventId: 'detached-1',
      body: { startAt: iso(9), endAt: iso(10) },
    });
  });

  it('undo of "only this" before the server has answered does not touch the series; it works once the answer is in', async () => {
    const h = setup();
    h.seedEvent('s', 9, 10, { rrule: 'FREQ=DAILY;COUNT=3' });
    const sent: { kind: string; eventId: string; scope?: string }[] = [];
    h.server.transport.send = async (c) => {
      sent.push({
        kind: c.kind,
        eventId: c.eventId,
        scope: c.kind === 'update' ? c.body.scope : undefined,
      });
      if (c.kind === 'update' && c.body.scope === 'this') {
        const master = h.server.events.get('s')!;
        const detached = {
          ...master,
          id: 'detached-1',
          rrule: null,
          seriesId: 's',
          originalStart: c.body.occurrenceStart ?? null,
          startAt: c.body.startAt!,
          endAt: c.body.endAt!,
          version: 1,
        };
        h.server.events.set('detached-1', detached);
        h.server.events.set('s', { ...master, version: master.version + 1 });
        return {
          type: 'ok',
          result: { events: [h.server.events.get('s')!, detached], deletedEventIds: [] },
        };
      }
      const target = h.server.events.get(c.eventId)!;
      if (c.kind === 'update') {
        h.server.events.set(c.eventId, {
          ...target,
          startAt: c.body.startAt ?? target.startAt,
          endAt: c.body.endAt ?? target.endAt,
          version: target.version + 1,
        });
      }
      return {
        type: 'ok',
        result: { events: [h.server.events.get(c.eventId)!], deletedEventIds: [] },
      };
    };
    const release = h.hold(); // the network is not answering (offline): the change waits
    h.runtime.actions.change(
      h.event('s'),
      { start: parseInstant(iso(14))!, end: parseInstant(iso(15))! },
      'this',
    );

    h.runtime.actions.undo(); // pressed before the server has said which event it created
    expect(h.notices.at(-1)).toMatchObject({ kind: 'info', code: 'UNDO_WAIT' });
    expect(h.runtime.history.get().past).toHaveLength(1); // the entry is kept, not lost

    release();
    await h.runtime.engine.whenIdle();
    // Nothing but the one edit reached the server: in particular no unscoped update of the series.
    expect(sent).toEqual([{ kind: 'update', eventId: 's', scope: 'this' }]);

    h.runtime.actions.undo(); // now the target is known: the detached event goes back, the series stays
    await h.runtime.engine.whenIdle();
    expect(sent.at(-1)).toEqual({ kind: 'update', eventId: 'detached-1', scope: undefined });
    expect(h.server.events.get('detached-1')?.startAt).toBe(iso(9));
    expect(h.server.events.get('s')?.startAt).toBe(iso(9)); // the series was never rewritten
  });

  it('a series split ("this and following") cannot be undone: the user is told, not silently ignored', async () => {
    const h = setup();
    h.seedEvent('s', 9, 10, { rrule: 'FREQ=DAILY;COUNT=3' });
    h.server.transport.send = async () => ({
      type: 'ok',
      result: { events: [], deletedEventIds: [] },
    });
    h.runtime.actions.change(h.event('s'), { title: 'x' }, 'following');
    await h.runtime.engine.whenIdle();
    h.runtime.actions.undo();
    expect(h.notices.at(-1)).toMatchObject({ kind: 'info', code: 'CANNOT_UNDO' });
  });
});
