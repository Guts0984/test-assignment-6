// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  amend,
  createBodyOf,
  emptyHistory,
  fieldsOf,
  HISTORY_LIMIT,
  popRedo,
  popUndo,
  record,
  type Entry,
  type History,
} from './history';

const entry = (n: number, undo: Entry['undo'] = { kind: 'delete', eventId: `e${n}` }): Entry => ({
  id: `h${n}`,
  label: `action ${n}`,
  undo,
  redo: { kind: 'update', eventId: `e${n}`, body: { title: `t${n}` } },
});
const ids = (list: readonly Entry[]) => list.map((e) => e.id);
const recordAll = (n: number): History =>
  Array.from({ length: n }, (_, i) => entry(i + 1)).reduce(record, emptyHistory);

describe('history limit', () => {
  it('keeps only the last 20 actions, oldest dropped first, order kept', () => {
    const h = recordAll(25);
    expect(h.past).toHaveLength(HISTORY_LIMIT);
    expect(ids(h.past)).toEqual(Array.from({ length: 20 }, (_, i) => `h${i + 6}`));
  });

  it('exactly 20 actions are all undoable, and the 21st is gone', () => {
    let h = recordAll(21);
    const undone: string[] = [];
    for (let popped = popUndo(h); popped; popped = popUndo(h)) {
      undone.push(popped.entry.id);
      h = popped.history;
    }
    expect(undone).toHaveLength(20);
    expect(undone).not.toContain('h1');
    expect(undone[0]).toBe('h21');
  });
});

describe('undo / redo', () => {
  it('undo walks back, redo walks forward, in exact reverse order', () => {
    let h = recordAll(3);
    const u1 = popUndo(h)!;
    h = u1.history;
    const u2 = popUndo(h)!;
    h = u2.history;
    expect([u1.entry.id, u2.entry.id]).toEqual(['h3', 'h2']);
    expect(ids(h.past)).toEqual(['h1']);
    expect(ids(h.future)).toEqual(['h3', 'h2']);
    const r1 = popRedo(h)!;
    h = r1.history;
    const r2 = popRedo(h)!;
    h = r2.history;
    expect([r1.entry.id, r2.entry.id]).toEqual(['h2', 'h3']);
    expect(ids(h.past)).toEqual(['h1', 'h2', 'h3']);
    expect(h.future).toEqual([]);
  });

  it('a new action after an undo clears what could be redone', () => {
    let h = recordAll(3);
    h = popUndo(h)!.history;
    expect(h.future).toHaveLength(1);
    h = record(h, entry(9));
    expect(h.future).toEqual([]);
    expect(ids(h.past)).toEqual(['h1', 'h2', 'h9']);
    expect(popRedo(h)).toBeNull();
  });

  it('undo and redo on an empty history do nothing', () => {
    expect(popUndo(emptyHistory)).toBeNull();
    expect(popRedo(emptyHistory)).toBeNull();
  });

  it('redo after exceeding the limit still respects it', () => {
    let h = recordAll(20);
    h = popUndo(h)!.history;
    h = record(h, entry(100));
    h = popUndo(h)!.history;
    h = popRedo(h)!.history;
    expect(h.past.length).toBeLessThanOrEqual(HISTORY_LIMIT);
  });

  it('an action that cannot be undone is dropped (and not offered for redo), the older ones stay reachable', () => {
    let h = record(record(emptyHistory, entry(1)), entry(2, null));
    const popped = popUndo(h)!;
    expect(popped.entry.undo).toBeNull();
    expect(popped.history.future).toEqual([]);
    expect(ids(popped.history.past)).toEqual(['h1']);
    h = popped.history;
    expect(popUndo(h)?.entry.id).toBe('h1');
  });

  it('never mutates the history it is given (safe as React state)', () => {
    const h = Object.freeze({
      past: Object.freeze([entry(1), entry(2)]),
      future: Object.freeze([]),
    }) as History;
    expect(() => popUndo(h)).not.toThrow();
    expect(() => record(h, entry(3))).not.toThrow();
    expect(ids(h.past)).toEqual(['h1', 'h2']);
  });
});

describe('amend', () => {
  it('fills in late information on the right entry only, wherever it is', () => {
    let h = recordAll(3);
    h = amend(h, 'h2', { undo: { kind: 'delete', eventId: 'server-chosen-id' } });
    expect(h.past[1]?.undo).toEqual({ kind: 'delete', eventId: 'server-chosen-id' });
    expect(h.past[0]?.undo).toEqual({ kind: 'delete', eventId: 'e1' });
    h = popUndo(h)!.history; // h3 moves to the future
    h = amend(h, 'h3', { label: 'renamed' });
    expect(h.future[0]?.label).toBe('renamed');
  });

  it('an unknown id changes nothing', () => {
    const h = recordAll(2);
    expect(ids(amend(h, 'nope', { label: 'x' }).past)).toEqual(['h1', 'h2']);
  });
});

describe('snapshots for undoing a delete', () => {
  const dto = {
    id: 'e1',
    roomId: 'r1',
    title: 'Standup',
    description: 'd',
    startAt: '2026-12-01T10:00:00Z',
    endAt: '2026-12-01T11:00:00Z',
    allDay: false,
    tzid: 'Europe/Kyiv',
    rrule: 'FREQ=WEEKLY;BYDAY=TU',
    exdates: [],
    seriesId: null,
    originalStart: null,
    version: 4,
    creatorId: 'u1',
    attendeeIds: ['u2', 'u3'],
  };

  it('re-creates the very same event: same id, zone, rule and attendees', () => {
    expect(createBodyOf(dto)).toEqual({
      id: 'e1',
      tzid: 'Europe/Kyiv',
      roomId: 'r1',
      title: 'Standup',
      description: 'd',
      startAt: dto.startAt,
      endAt: dto.endAt,
      allDay: false,
      rrule: 'FREQ=WEEKLY;BYDAY=TU',
      attendeeIds: ['u2', 'u3'],
    });
  });

  it('fieldsOf copies (not aliases) the attendee list so later edits cannot change the snapshot', () => {
    const f = fieldsOf(dto);
    expect(f.attendeeIds).toEqual(dto.attendeeIds);
    expect(f.attendeeIds).not.toBe(dto.attendeeIds);
  });
});
