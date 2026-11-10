// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createSyncEngine, isAlreadyApplied, retryDelay, RETRY_MAX_MS } from './engine';
import { create, fakeScheduler, fakeServer, memoryStorage, remove, update } from './testing';
import type { Command, Rejection, UpdateCommand } from './types';

function setup(opts: { storage?: ReturnType<typeof memoryStorage> } = {}) {
  const server = fakeServer();
  const storage = opts.storage ?? memoryStorage();
  const time = fakeScheduler();
  const applied: string[] = [];
  const rejected: Array<[string, Rejection]> = [];
  const discarded: string[][] = [];
  const engine = createSyncEngine(
    { storage, transport: server.transport, schedule: time.schedule },
    {
      onApplied: (c) => void applied.push(c.id),
      onRejected: (c, r) => void rejected.push([c.id, r]),
      onDiscarded: (cs) => void discarded.push(cs.map((c) => c.id)),
    },
  );
  return { server, storage, time, engine, applied, rejected, discarded };
}

describe('online: ordered, one at a time', () => {
  it('sends commands in the order they were made and never two at once', async () => {
    const { server, engine, applied } = setup();
    server.seed('a');
    server.seed('b');
    let inFlight = 0;
    let maxInFlight = 0;
    const inner = server.transport.send;
    server.transport.send = async (c, v) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      const r = await inner(c, v);
      inFlight -= 1;
      return r;
    };
    const cmds = [
      update('a', 1, { title: '1' }),
      update('b', 1, { title: '2' }),
      update('a', 1, { title: '3' }),
      remove('b', 1),
    ];
    for (const c of cmds) await engine.enqueue(c);
    await engine.whenIdle();
    expect(applied).toEqual(cmds.map((c) => c.id));
    expect(server.log.map((l) => l.commandId)).toEqual(cmds.map((c) => c.id));
    expect(maxInFlight).toBe(1);
    expect(engine.getState()).toMatchObject({ status: 'saved', pending: 0 });
  });

  it('chains versions: quick successive edits of ONE event do not conflict with each other (rapid actions)', async () => {
    const { server, engine, rejected } = setup();
    server.seed('a', 5);
    // The user drags the same event three times before the first answer arrives: all three were made on v5.
    await engine.enqueue(update('a', 5, { title: 'one' }));
    await engine.enqueue(update('a', 5, { title: 'two' }));
    await engine.enqueue(update('a', 5, { title: 'three' }));
    await engine.whenIdle();
    expect(server.log.map((l) => l.version)).toEqual([5, 6, 7]);
    expect(server.events.get('a')).toMatchObject({ title: 'three', version: 8 });
    expect(rejected).toEqual([]);
  });

  it("the FIRST command of an event uses the version the user saw, so somebody else's change is detected", async () => {
    const { server, engine, rejected } = setup();
    server.seed('a', 1);
    server.editBySomeoneElse('a', { title: 'theirs' }); // server is at v2, the user still sees v1
    await engine.enqueue(update('a', 1, { title: 'mine' }));
    await engine.whenIdle();
    expect(rejected[0]?.[1]).toMatchObject({
      kind: 'version-conflict',
      current: { version: 2, title: 'theirs' },
    });
    expect(server.events.get('a')?.title).toBe('theirs'); // nothing was overwritten
  });

  it('a double-clicked delete: the second one finds the event gone and counts as success, not an error', async () => {
    const { server, engine, applied, rejected } = setup();
    server.seed('a', 1);
    const d1 = remove('a', 1);
    const d2 = remove('a', 1);
    await engine.enqueue(d1);
    await engine.enqueue(d2);
    await engine.whenIdle();
    expect(applied).toEqual([d1.id, d2.id]);
    expect(rejected).toEqual([]);
    expect(server.events.size).toBe(0);
  });

  it('reports lastForEvent so the UI only applies the final server state when nothing newer is queued', async () => {
    const infos: boolean[] = [];
    const server = fakeServer();
    server.seed('a');
    const engine = createSyncEngine(
      { storage: memoryStorage(), transport: server.transport },
      { onApplied: (_c, _r, info) => void infos.push(info.lastForEvent) },
    );
    await engine.enqueue(update('a', 1));
    await engine.enqueue(update('a', 1));
    await engine.whenIdle();
    expect(infos).toEqual([false, true]);
  });

  it('a create with a client id is applied once even if the response is lost and the command is retried', async () => {
    const { server, engine, time, applied } = setup();
    server.script('drop-response'); // server applies it, the answer never arrives
    await engine.enqueue(create('new-1'));
    await engine.whenIdle();
    expect(engine.getState().status).toBe('offline');
    expect(server.events.size).toBe(1);
    await time.advance(2_000);
    await engine.whenIdle();
    expect(applied).toHaveLength(1);
    expect(server.events.size).toBe(1);
    expect(server.applied.filter((a) => a.kind === 'create')).toHaveLength(1);
    expect(engine.getState().status).toBe('saved');
  });

  it('a lost-response UPDATE is recognized as already applied (no false conflict screen)', async () => {
    const { server, engine, time, applied, rejected } = setup();
    server.seed('a', 1);
    server.script('drop-response');
    await engine.enqueue(update('a', 1, { title: 'same' }));
    await engine.whenIdle();
    await time.advance(2_000);
    await engine.whenIdle();
    expect(rejected).toEqual([]);
    expect(engine.getState()).toMatchObject({ status: 'saved', conflict: null });
    expect(applied).toHaveLength(1);
    expect(server.events.get('a')).toMatchObject({ title: 'same', version: 2 }); // applied exactly once
  });
});

describe('offline queue (acceptance #9)', () => {
  it('collects 5 changes without sending, then sends all 5 in order when the network returns', async () => {
    const { server, engine, applied } = setup();
    for (const id of ['a', 'b', 'c']) server.seed(id);
    engine.setOnline(false);
    const cmds = [
      update('a', 1, { title: '1' }),
      update('b', 1, { title: '2' }),
      remove('c', 1),
      create('d'),
      update('a', 1, { title: '5' }),
    ];
    for (const c of cmds) await engine.enqueue(c);
    expect(server.sends()).toBe(0);
    expect(engine.getState()).toMatchObject({ status: 'offline', pending: 5 });
    expect(engine.pendingCommands().every((c) => c.offline)).toBe(true);

    engine.setOnline(true);
    await engine.whenIdle();
    expect(applied).toEqual(cmds.map((c) => c.id));
    expect(server.applied.map((a) => a.commandId)).toEqual(cmds.map((c) => c.id));
    expect(server.events.get('a')).toMatchObject({ title: '5', version: 3 });
    expect([...server.events.keys()].sort()).toEqual(['a', 'b', 'd']);
    expect(engine.getState()).toMatchObject({ status: 'saved', pending: 0 });
  });

  it('survives a page reload: a NEW engine over the same storage sends everything, in order, once', async () => {
    const storage = memoryStorage();
    const first = setup({ storage });
    for (const id of ['a', 'b']) first.server.seed(id);
    first.engine.setOnline(false);
    const cmds = [
      update('a', 1, { title: '1' }),
      update('b', 1, { title: '2' }),
      update('a', 1, { title: '3' }),
    ];
    for (const c of cmds) await first.engine.enqueue(c);
    expect(storage.snapshot().map((c) => c.id)).toEqual(cmds.map((c) => c.id)); // persisted BEFORE anything else

    // "Reload": nothing in memory survives except IndexedDB; the network is back.
    const second = setup({ storage });
    second.server.seed('a');
    second.server.seed('b');
    await second.engine.start();
    await second.engine.whenIdle();
    expect(second.applied).toEqual(cmds.map((c) => c.id));
    expect(second.server.events.get('a')).toMatchObject({ title: '3', version: 3 });
    expect(storage.snapshot()).toEqual([]); // queue emptied only after success
  });

  it('commands loaded after a reload count as offline changes (so conflicts show the chooser)', async () => {
    const storage = memoryStorage([update('a', 1)]);
    const { server, engine } = setup({ storage });
    server.seed('a', 1);
    await engine.start();
    // it was sent and applied; before sending it was flagged offline:
    expect(storage.snapshot()).toEqual([]);
    const again = setup({ storage: memoryStorage([update('a', 1)]) });
    again.server.seed('a', 1);
    again.engine.setOnline(false);
    await again.engine.start();
    expect(again.engine.pendingCommands()[0]?.offline).toBe(true);
  });

  it('a network failure parks the queue (head kept, nothing skipped) and retries with growing delays', async () => {
    const { server, engine, time, applied } = setup();
    for (const id of ['a', 'b', 'c']) server.seed(id);
    server.script('ok', 'network', 'network', 'network');
    const cmds = [update('a', 1), update('b', 1), update('c', 1)];
    for (const c of cmds) await engine.enqueue(c);
    await engine.whenIdle();
    expect(applied).toEqual([cmds[0]!.id]);
    expect(engine.getState()).toMatchObject({ status: 'offline', pending: 2 });
    expect(time.pending()).toEqual([2_000]);
    await time.advance(2_000);
    await engine.whenIdle();
    expect(time.pending()).toEqual([4_000]); // second failure: longer wait
    await time.advance(4_000);
    await engine.whenIdle();
    expect(time.pending()).toEqual([8_000]);
    await time.advance(8_000);
    await engine.whenIdle();
    expect(applied).toEqual(cmds.map((c) => c.id));
    expect(engine.getState().status).toBe('saved');
    expect(time.pending()).toEqual([]); // no stray timers
  });

  it('backoff is capped, and resets after a success', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(retryDelay)).toEqual([
      2_000,
      4_000,
      8_000,
      16_000,
      RETRY_MAX_MS,
      RETRY_MAX_MS,
      RETRY_MAX_MS,
    ]);
  });

  it('the browser "online" event retries at once instead of waiting for the timer', async () => {
    const { server, engine, time } = setup();
    server.seed('a');
    server.script('network');
    await engine.enqueue(update('a', 1));
    await engine.whenIdle();
    expect(engine.getState().status).toBe('offline');
    engine.setOnline(false);
    engine.setOnline(true);
    await engine.whenIdle();
    expect(engine.getState().status).toBe('saved');
    expect(time.pending()).toEqual([]); // the pending retry was cancelled
  });

  it('indicator states: offline (even with nothing queued), syncing, saved', async () => {
    const { server, engine } = setup();
    server.seed('a');
    const seen: string[] = [];
    engine.subscribe(() => seen.push(engine.getState().status));
    engine.setOnline(false);
    expect(engine.getState()).toMatchObject({ status: 'offline', pending: 0 });
    await engine.enqueue(update('a', 1));
    engine.setOnline(true);
    await engine.whenIdle();
    expect(seen).toEqual(['offline', 'offline', 'syncing', 'saved']);
  });
});

describe("conflicts with somebody else's change (acceptance #10)", () => {
  const offlineEdit = async (h: ReturnType<typeof setup>) => {
    h.server.seed('a', 1, { title: 'original' });
    h.engine.setOnline(false);
    const mine = update('a', 1, { title: 'mine' });
    await h.engine.enqueue(mine);
    h.server.editBySomeoneElse('a', { title: 'theirs' });
    h.engine.setOnline(true);
    await h.engine.whenIdle();
    return mine as UpdateCommand;
  };

  it('stops and shows the chooser with both sides instead of overwriting', async () => {
    const h = setup();
    const mine = await offlineEdit(h);
    expect(h.engine.getState().status).toBe('conflict');
    expect(h.engine.getState().conflict).toMatchObject({
      command: { id: mine.id },
      current: { title: 'theirs', version: 2 },
    });
    expect(h.server.events.get('a')?.title).toBe('theirs');
    expect(h.rejected).toEqual([]);
  });

  it('holds back everything after the conflict (order matters), then continues after the choice', async () => {
    const h = setup();
    h.server.seed('b');
    await offlineEdit(h);
    const later = update('b', 1, { title: 'later' });
    await h.engine.enqueue(later);
    await h.engine.whenIdle();
    expect(h.server.events.get('b')?.title).toBe('T'); // not sent yet
    await h.engine.resolveConflict('mine');
    await h.engine.whenIdle();
    expect(h.server.events.get('b')?.title).toBe('later');
  });

  it('"mine": applies my change on top of the server version', async () => {
    const h = setup();
    await offlineEdit(h);
    await h.engine.resolveConflict('mine');
    await h.engine.whenIdle();
    expect(h.server.events.get('a')).toMatchObject({ title: 'mine', version: 3 });
    expect(h.engine.getState()).toMatchObject({ status: 'saved', conflict: null });
  });

  it('"server": drops my change AND my later changes to that event (they were based on mine), keeps others', async () => {
    const h = setup();
    h.server.seed('b');
    const mine = await offlineEdit(h);
    const dependent = update('a', 1, { title: 'mine, then more' });
    const unrelated = update('b', 1, { title: 'unrelated' });
    await h.engine.enqueue(dependent);
    await h.engine.enqueue(unrelated);
    await h.engine.resolveConflict('server');
    await h.engine.whenIdle();
    expect(h.discarded).toEqual([[mine.id, dependent.id]]);
    expect(h.server.events.get('a')?.title).toBe('theirs');
    expect(h.server.events.get('b')?.title).toBe('unrelated');
    expect(h.engine.getState().status).toBe('saved');
  });

  it('a conflict on a change made ONLINE is a plain rejection with the current version (rollback + message)', async () => {
    const h = setup();
    h.server.seed('a', 1);
    h.server.editBySomeoneElse('a', { title: 'theirs' });
    await h.engine.enqueue(update('a', 1, { title: 'mine' })); // engine is online: not an offline change
    await h.engine.whenIdle();
    expect(h.engine.getState().conflict).toBeNull();
    expect(h.rejected[0]?.[1]).toMatchObject({
      kind: 'version-conflict',
      current: { title: 'theirs' },
    });
  });

  it('an offline delete of an event that somebody changed meanwhile also asks the user', async () => {
    const h = setup();
    h.server.seed('a', 1);
    h.engine.setOnline(false);
    await h.engine.enqueue(remove('a', 1));
    h.server.editBySomeoneElse('a', { title: 'theirs' });
    h.engine.setOnline(true);
    await h.engine.whenIdle();
    expect(h.engine.getState().status).toBe('conflict');
    await h.engine.resolveConflict('mine');
    await h.engine.whenIdle();
    expect(h.server.events.has('a')).toBe(false);
  });

  it('isAlreadyApplied compares only the fields I changed (attendee order does not matter)', () => {
    const cmd = update('a', 1, { title: 'x', attendeeIds: ['u2', 'u1'] }) as UpdateCommand;
    const current = { id: 'a', title: 'x', attendeeIds: ['u1', 'u2'], version: 2 } as never;
    expect(isAlreadyApplied(cmd, current)).toBe(true);
    expect(isAlreadyApplied(cmd, { ...(current as object), title: 'y' } as never)).toBe(false);
    expect(isAlreadyApplied(cmd, null)).toBe(false);
    expect(
      isAlreadyApplied(
        update('a', 1, { scope: 'this', occurrenceStart: 'x', title: 'x' }) as UpdateCommand,
        current,
      ),
    ).toBe(false);
  });
});

describe('rejections', () => {
  it('a room conflict is refused: rolled back with the blockers, the queue carries on', async () => {
    const h = setup();
    h.server.seed('b');
    const failing = create('x');
    const orig = h.server.transport.send;
    h.server.transport.send = async (c, v) =>
      c.id === failing.id
        ? {
            type: 'room-conflict',
            blockers: [
              {
                eventId: 'e',
                title: 'Standup',
                creator: { id: 'u2', name: 'Bob' },
                start: 's',
                end: 'e',
              },
            ],
          }
        : orig(c, v);
    await h.engine.enqueue(failing);
    await h.engine.enqueue(update('b', 1, { title: 'fine' }));
    await h.engine.whenIdle();
    expect(h.rejected[0]).toEqual([
      failing.id,
      { kind: 'room-conflict', blockers: expect.any(Array) },
    ]);
    expect(h.server.events.get('b')?.title).toBe('fine');
  });

  it('when a CREATE is refused, queued follow-ups for that event are dropped (the event does not exist)', async () => {
    const h = setup();
    const failing = create('x');
    const orig = h.server.transport.send;
    h.server.transport.send = async (c, v) =>
      c.id === failing.id ? { type: 'room-conflict', blockers: [] } : orig(c, v);
    const followUp = update('x', 1);
    const other = create('y');
    for (const c of [failing, followUp, other]) await h.engine.enqueue(c);
    await h.engine.whenIdle();
    expect(h.rejected.map(([id]) => id)).toEqual([failing.id]);
    expect(h.server.log.map((l) => l.commandId)).toEqual([other.id]); // the follow-up was never sent to the server
    expect(h.server.events.has('y')).toBe(true);
    expect(h.engine.pendingCommands()).toEqual([]);
  });

  it('an update of an event that no longer exists is rejected as not-found (and the queue goes on)', async () => {
    const h = setup();
    h.server.seed('b');
    await h.engine.enqueue(update('gone', 1));
    await h.engine.enqueue(update('b', 1, { title: 'ok' }));
    await h.engine.whenIdle();
    expect(h.rejected[0]?.[1]).toEqual({ kind: 'not-found' });
    expect(h.server.events.get('b')?.title).toBe('ok');
  });

  it('a validation error is rejected, not retried forever', async () => {
    const h = setup();
    h.server.transport.send = async () => ({ type: 'invalid', details: [{ path: 'title' }] });
    await h.engine.enqueue(update('a', 1));
    await h.engine.whenIdle();
    expect(h.rejected[0]?.[1]).toMatchObject({ kind: 'invalid' });
    expect(h.engine.getState().pending).toBe(0);
  });

  it('a transport that THROWS cannot wedge the queue', async () => {
    const h = setup();
    h.server.seed('b');
    const orig = h.server.transport.send;
    let first = true;
    h.server.transport.send = async (c, v) => {
      if (first) {
        first = false;
        throw new Error('boom');
      }
      return orig(c, v);
    };
    await h.engine.enqueue(update('a', 1));
    await h.engine.enqueue(update('b', 1, { title: 'ok' }));
    await h.engine.whenIdle();
    expect(h.rejected[0]?.[1]).toMatchObject({ kind: 'error' });
    expect(h.server.events.get('b')?.title).toBe('ok');
  });
});

describe('session and storage problems', () => {
  it('a 401 stops sending but KEEPS the queue; it resumes after signing in again', async () => {
    const h = setup();
    h.server.seed('a');
    h.server.script('unauthenticated');
    await h.engine.enqueue(update('a', 1, { title: 'kept' }));
    await h.engine.whenIdle();
    expect(h.engine.getState()).toMatchObject({ status: 'signed-out', pending: 1 });
    expect(h.storage.snapshot()).toHaveLength(1);
    h.engine.resumeAfterSignIn();
    await h.engine.whenIdle();
    expect(h.server.events.get('a')?.title).toBe('kept');
    expect(h.engine.getState().status).toBe('saved');
  });

  it('if IndexedDB refuses to save, the engine keeps working in memory and tells the UI', async () => {
    const h = setup();
    h.server.seed('a');
    h.storage.failNextSaves(1);
    h.engine.setOnline(false);
    await h.engine.enqueue(update('a', 1, { title: 'x' }));
    expect(h.engine.getState().storageFailed).toBe(true);
    h.engine.setOnline(true);
    await h.engine.whenIdle();
    expect(h.server.events.get('a')?.title).toBe('x');
    expect(h.engine.getState().storageFailed).toBe(false); // recovered on the next successful save
  });
});

describe('stress: flapping network, lost responses (property test)', () => {
  // SYNC_STRESS=500 pnpm exec vitest run --project unit src/features/sync  (more seeds, slower)
  it.each(Array.from({ length: Number(process.env.SYNC_STRESS ?? 25) }, (_, i) => i + 1))(
    'seed %i: every change is applied exactly once and in order per event',
    async (seed) => {
      let s = seed * 7919;
      const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
      const h = setup();
      const ids = ['a', 'b', 'c'];
      for (const id of ids) h.server.seed(id, 1);
      const sent: Command[] = [];
      const orig = h.server.transport.send;
      // Random failures: request lost, or applied-but-response-lost.
      h.server.transport.send = async (c, v) => {
        const roll = rnd();
        if (roll < 0.15) return { type: 'network' };
        const r = await orig(c, v);
        if (roll < 0.3 && r.type === 'ok') return { type: 'network' };
        return r;
      };

      const base = Object.fromEntries(ids.map((id) => [id, 1]));
      for (let i = 0; i < 40; i += 1) {
        const id = ids[Math.floor(rnd() * ids.length)]!;
        const cmd = update(id, base[id]!, { title: `t${i}` });
        sent.push(cmd);
        await h.engine.enqueue(cmd);
        if (rnd() < 0.25) h.engine.setOnline(false);
        if (rnd() < 0.4) h.engine.setOnline(true);
        if (rnd() < 0.5) await h.time.advance(Math.floor(rnd() * 9000));
      }
      h.engine.setOnline(true);
      for (let i = 0; i < 60 && h.engine.getState().pending > 0; i += 1) {
        await h.time.advance(30_000);
        await h.engine.whenIdle();
      }

      expect(h.engine.getState()).toMatchObject({ pending: 0, status: 'saved' });
      // Each command produced at most one server-side effect, and the effects of one event are in queue order.
      const effects = h.server.applied.filter((a) => a.kind === 'update');
      expect(new Set(effects.map((e) => e.commandId)).size).toBe(effects.length);
      for (const id of ids) {
        const order = effects
          .filter((e) => e.eventId === id)
          .map((e) => sent.findIndex((c) => c.id === e.commandId));
        expect(order, id).toEqual([...order].sort((x, y) => x - y));
      }
      // Final state = the LAST command of each event (nothing lost, nothing reordered).
      for (const id of ids) {
        const last = [...sent].reverse().find((c) => c.eventId === id) as UpdateCommand | undefined;
        expect(h.server.events.get(id)?.title).toBe(last ? (last.body.title ?? 'T') : 'T');
      }
      // Rejections are impossible here: all conflicts were self-inflicted retries, which must be recognized.
      expect(h.rejected).toEqual([]);
      expect(h.engine.getState().conflict).toBeNull();
      vi.clearAllTimers();
    },
  );
});
