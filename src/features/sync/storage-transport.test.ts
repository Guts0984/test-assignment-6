// @vitest-environment node
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { createIdbStorage } from './idb-storage';
import { create, remove, update } from './testing';
import { requestFor, toSendResult } from './transport';

describe('IndexedDB queue storage', () => {
  it('returns what was saved, in order, as plain data', async () => {
    const storage = createIdbStorage('u1', new IDBFactory());
    const queue = [
      create('a'),
      update('a', 1, { title: 'x', startAt: '2026-12-01T10:00:00Z' }),
      remove('a', 2),
    ];
    await storage.save(queue);
    expect(await storage.load()).toEqual(queue);
  });

  it('survives a "page reload": a brand-new storage object over the same database sees the queue', async () => {
    const idb = new IDBFactory();
    await createIdbStorage('u1', idb).save([update('a', 1), update('b', 3)]);
    const reloaded = createIdbStorage('u1', idb);
    expect((await reloaded.load()).map((c) => c.eventId)).toEqual(['a', 'b']);
  });

  it('an empty queue clears the record, and loading from nothing gives an empty queue', async () => {
    const idb = new IDBFactory();
    const s = createIdbStorage('u1', idb);
    expect(await s.load()).toEqual([]);
    await s.save([update('a', 1)]);
    await s.save([]);
    expect(await s.load()).toEqual([]);
  });

  it('is isolated per user: another user on the same browser never sees (or replays) this queue', async () => {
    const idb = new IDBFactory();
    await createIdbStorage('ana', idb).save([update('a', 1)]);
    expect(await createIdbStorage('bob', idb).load()).toEqual([]);
    await createIdbStorage('bob', idb).save([update('b', 1)]);
    expect((await createIdbStorage('ana', idb).load()).map((c) => c.eventId)).toEqual(['a']);
  });

  it('each save replaces the whole queue (the last write wins, nothing is appended twice)', async () => {
    const idb = new IDBFactory();
    const s = createIdbStorage('u1', idb);
    await s.save([update('a', 1), update('b', 1)]);
    await s.save([update('b', 1)]);
    expect((await s.load()).map((c) => c.eventId)).toEqual(['b']);
  });

  it('concurrent saves finish in the order they were issued', async () => {
    const idb = new IDBFactory();
    const s = createIdbStorage('u1', idb);
    await Promise.all([
      s.save([update('a', 1)]),
      s.save([update('a', 1), update('b', 1)]),
      s.save([update('c', 1)]),
    ]);
    expect((await s.load()).map((c) => c.eventId)).toEqual(['c']);
  });
});

describe('HTTP mapping', () => {
  const failure = (code: string, status: number, details?: unknown) => ({
    ok: false as const,
    kind: 'api' as const,
    status,
    code: code as never,
    details,
  });

  it('maps each answer to the outcome the engine acts on', () => {
    expect(
      toSendResult({ ok: true, status: 200, data: { events: [], deletedEventIds: [] } }),
    ).toEqual({ type: 'ok', result: { events: [], deletedEventIds: [] } });
    expect(toSendResult({ ok: false, kind: 'network', status: 0, code: 'NETWORK' })).toEqual({
      type: 'network',
    });
    expect(toSendResult(failure('UNAUTHENTICATED', 401))).toEqual({ type: 'unauthenticated' });
    expect(toSendResult(failure('NOT_FOUND', 404))).toEqual({ type: 'not-found' });
    expect(toSendResult(failure('VALIDATION', 400, [{ path: 'title' }]))).toEqual({
      type: 'invalid',
      details: [{ path: 'title' }],
    });
    expect(
      toSendResult(failure('VERSION_CONFLICT', 409, { current: { id: 'x', version: 4 } })),
    ).toEqual({ type: 'version-conflict', current: { id: 'x', version: 4 } });
    expect(
      toSendResult(failure('ROOM_CONFLICT', 409, { blockers: [{ title: 'Standup' }] })),
    ).toEqual({ type: 'room-conflict', blockers: [{ title: 'Standup' }] });
  });

  it('tolerates a malformed conflict body instead of crashing', () => {
    expect(toSendResult(failure('VERSION_CONFLICT', 409))).toEqual({
      type: 'version-conflict',
      current: null,
    });
    expect(toSendResult(failure('ROOM_CONFLICT', 409))).toEqual({
      type: 'room-conflict',
      blockers: [],
    });
  });

  it('a server error (5xx) is retried like a network problem; other 4xx are final', () => {
    expect(toSendResult(failure('UNKNOWN', 500))).toEqual({ type: 'network' });
    expect(toSendResult(failure('UNKNOWN', 503))).toEqual({ type: 'network' });
    expect(toSendResult(failure('FORBIDDEN_ORIGIN', 403))).toEqual({
      type: 'error',
      status: 403,
      code: 'FORBIDDEN_ORIGIN',
    });
  });

  it('builds the requests the API expects (version in the body for PATCH, in the query for DELETE)', () => {
    expect(requestFor(create('n1'), 1)).toMatchObject({
      method: 'POST',
      path: '/api/events',
      body: { id: 'n1' },
    });
    expect(
      requestFor(
        update('e1', 3, { title: 'x', scope: 'this', occurrenceStart: '2026-03-30T06:00:00Z' }),
        7,
      ),
    ).toEqual({
      method: 'PATCH',
      path: '/api/events/e1',
      body: { title: 'x', scope: 'this', occurrenceStart: '2026-03-30T06:00:00Z', version: 7 },
    });
    expect(requestFor(remove('e1', 3), 5).path).toBe('/api/events/e1?version=5');
    const scoped = {
      ...remove('e1', 3),
      scope: 'following' as const,
      occurrenceStart: '2026-03-30T06:00:00Z',
    };
    expect(requestFor(scoped, 5).path).toBe(
      '/api/events/e1?version=5&scope=following&occurrenceStart=2026-03-30T06%3A00%3A00Z',
    );
  });

  it('the resolved version, not the one stored in the command, is what is sent', () => {
    expect(requestFor(update('e1', 1), 9).body).toMatchObject({ version: 9 });
  });
});
