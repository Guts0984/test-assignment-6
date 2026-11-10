// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { EventDto } from '@/shared/contracts';
import { diffRows, interestingRows } from './conflict-diff';
import { remove, update } from './testing';
import type { DeleteCommand, UpdateCommand } from './types';

const server: EventDto = {
  id: 'e1',
  roomId: 'room-b',
  title: 'Their title',
  description: 'd',
  startAt: '2026-12-01T10:00:00Z',
  endAt: '2026-12-01T11:00:00Z',
  allDay: false,
  tzid: 'UTC',
  rrule: null,
  exdates: [],
  seriesId: null,
  originalStart: null,
  version: 3,
  creatorId: 'u1',
  attendeeIds: ['u2', 'u1'],
};
const rows = (cmd: UpdateCommand | DeleteCommand) =>
  Object.fromEntries(diffRows(cmd, server).map((r) => [r.field, r]));

describe('diffRows (conflict screen)', () => {
  it('flags the fields where my change and the server disagree, with both values', () => {
    const r = rows(
      update('e1', 1, {
        title: 'My title',
        startAt: '2026-12-01T14:00:00Z',
        endAt: '2026-12-01T15:00:00Z',
      }) as UpdateCommand,
    );
    expect(r.title).toMatchObject({
      mine: 'My title',
      server: 'Their title',
      differs: true,
      changedByMe: true,
    });
    expect(r.start).toMatchObject({
      mine: '2026-12-01T14:00:00Z',
      server: '2026-12-01T10:00:00Z',
      differs: true,
    });
    expect(r.end?.differs).toBe(true);
  });

  it('fields I did not touch show the server value on both sides and are not flagged', () => {
    const r = rows(update('e1', 1, { title: 'My title' }) as UpdateCommand);
    expect(r.roomId).toMatchObject({
      mine: 'room-b',
      server: 'room-b',
      differs: false,
      changedByMe: false,
    });
    expect(r.description?.differs).toBe(false);
  });

  it('a change that happens to equal the server value is not a difference (both made the same edit)', () => {
    const r = rows(update('e1', 1, { title: 'Their title' }) as UpdateCommand);
    expect(r.title).toMatchObject({ differs: false, changedByMe: true });
  });

  it('attendees compare as sets (order does not matter)', () => {
    expect(
      rows(update('e1', 1, { attendeeIds: ['u1', 'u2'] }) as UpdateCommand).attendeeIds?.differs,
    ).toBe(false);
    expect(
      rows(update('e1', 1, { attendeeIds: ['u1', 'u3'] }) as UpdateCommand).attendeeIds?.differs,
    ).toBe(true);
  });

  it('a delete shows the event that would be removed, nothing flagged', () => {
    const r = rows(remove('e1', 1) as DeleteCommand);
    expect(Object.values(r).every((x) => !x.differs && !x.changedByMe)).toBe(true);
    expect(r.title?.server).toBe('Their title');
  });

  it('interestingRows keeps only differing or edited rows', () => {
    const list = diffRows(
      update('e1', 1, { title: 'x', description: 'd' }) as UpdateCommand,
      server,
    );
    expect(interestingRows(list).map((r) => r.field)).toEqual(['title', 'description']);
  });

  it('covers every field the dialog can show, in a stable order', () => {
    expect(diffRows(remove('e1', 1) as DeleteCommand, server).map((r) => r.field)).toEqual([
      'title',
      'roomId',
      'start',
      'end',
      'allDay',
      'description',
      'attendeeIds',
    ]);
  });
});
