// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createBus } from './bus';

const seqOf = (id: string) => Number(id.split(':')[1]);

describe('bus ids and replay', () => {
  it('gives increasing ids with a stable epoch and starts empty', () => {
    const bus = createBus({ epoch: 'e1' });
    expect(bus.latestId()).toBe('e1:0');
    expect(bus.publish('t', 1, null).id).toBe('e1:1');
    expect(bus.publish('t', 2, null).id).toBe('e1:2');
    expect(bus.latestId()).toBe('e1:2');
  });

  it('a fresh connection (no Last-Event-ID) replays nothing', () => {
    const bus = createBus({ epoch: 'e' });
    bus.publish('t', 1, null);
    expect(bus.replay(undefined)).toEqual({ kind: 'messages', messages: [] });
  });

  it('replays exactly what came after the given id, in order, without that message itself', () => {
    const bus = createBus({ epoch: 'e' });
    const ids = [1, 2, 3, 4].map((n) => bus.publish('t', n, null).id);
    const r = bus.replay(ids[1]);
    expect(r.kind === 'messages' && r.messages.map((m) => m.data)).toEqual([3, 4]);
    expect(bus.replay(ids[3])).toEqual({ kind: 'messages', messages: [] }); // up to date
    expect(bus.replay('e:0')).toMatchObject({ kind: 'messages' }); // everything
  });

  it('asks for a resync when the history has a gap (evicted), another epoch, junk, or the future', () => {
    const bus = createBus({ epoch: 'e', capacity: 3 });
    const ids = [1, 2, 3, 4, 5].map((n) => bus.publish('t', n, null).id); // buffer holds 3,4,5
    expect(bus.replay(ids[0])).toEqual({ kind: 'resync' }); // wants 2.., but 2 is gone
    const edge = bus.replay(ids[1]); // wants 3.., which is exactly the oldest we have
    expect(edge.kind === 'messages' && edge.messages.map((m) => m.data)).toEqual([3, 4, 5]);
    expect(bus.replay('other:3')).toEqual({ kind: 'resync' });
    expect(bus.replay('e:99')).toEqual({ kind: 'resync' });
    for (const junk of ['', 'e', 'e:', 'e:x', ':5', 'e:-1', 'e:1:2']) {
      expect(bus.replay(junk), junk).toEqual({ kind: 'resync' });
    }
  });

  it('never holds more than `capacity` messages, however many are published', () => {
    const bus = createBus({ epoch: 'e', capacity: 10 });
    for (let i = 0; i < 1000; i += 1) bus.publish('t', i, null);
    const r = bus.replay('e:990');
    expect(r.kind === 'messages' && r.messages).toHaveLength(10);
    expect(bus.replay('e:989')).toEqual({ kind: 'resync' });
  });

  it('a new bus (server restart) never accepts ids of an old one, even with the same sequence', () => {
    const a = createBus();
    const b = createBus();
    const id = a.publish('t', 1, null).id;
    b.publish('t', 1, null);
    expect(b.replay(id)).toEqual({ kind: 'resync' });
    expect(seqOf(id)).toBe(1);
  });
});

describe('bus subscribers', () => {
  it('delivers to every subscriber, then stops after unsubscribe (and unsubscribing twice is harmless)', () => {
    const bus = createBus();
    const a: number[] = [];
    const b: number[] = [];
    const offA = bus.subscribe((m) => a.push(m.data as number));
    bus.subscribe((m) => b.push(m.data as number));
    bus.publish('t', 1, null);
    offA();
    offA();
    bus.publish('t', 2, null);
    expect([a, b]).toEqual([[1], [1, 2]]);
    expect(bus.subscriberCount()).toBe(1);
  });

  it('a throwing subscriber does not stop the others or the publisher', () => {
    const bus = createBus();
    const got: number[] = [];
    bus.subscribe(() => {
      throw new Error('boom');
    });
    bus.subscribe((m) => got.push(m.data as number));
    expect(() => bus.publish('t', 7, null)).not.toThrow();
    expect(got).toEqual([7]);
  });

  it('a subscriber may unsubscribe itself while being notified without skipping the next one', () => {
    const bus = createBus();
    const got: string[] = [];
    const off = bus.subscribe(() => {
      got.push('first');
      off();
    });
    bus.subscribe(() => got.push('second'));
    bus.publish('t', 1, null);
    bus.publish('t', 2, null);
    expect(got).toEqual(['first', 'second', 'second']);
  });

  it('carries the origin through', () => {
    const bus = createBus();
    let seen: unknown;
    bus.subscribe((m) => (seen = m.origin));
    bus.publish('t', 1, 'tab-9');
    expect(seen).toBe('tab-9');
  });
});
