import type { EventDto } from '@/shared/contracts';
import type { DeleteCommand, UpdateCommand } from './types';

export type DiffField =
  'title' | 'roomId' | 'start' | 'end' | 'allDay' | 'description' | 'attendeeIds';
export const DIFF_FIELDS: readonly DiffField[] = [
  'title',
  'roomId',
  'start',
  'end',
  'allDay',
  'description',
  'attendeeIds',
];

export type DiffRow = {
  field: DiffField;
  /** My version of this field (my change if I changed it, else the server's value). */
  mine: string | boolean | string[];
  /** The server's current value. */
  server: string | boolean | string[];
  /** The two sides disagree: highlight this row. */
  differs: boolean;
  /** I edited this field (as opposed to it differing only because somebody else changed it... never both, see below). */
  changedByMe: boolean;
};

const serverValue = (e: EventDto, f: DiffField): DiffRow['server'] =>
  f === 'start'
    ? e.startAt
    : f === 'end'
      ? e.endAt
      : f === 'attendeeIds'
        ? [...e.attendeeIds].sort()
        : (e[f] as string | boolean);

const mineValue = (
  c: UpdateCommand,
  e: EventDto,
  f: DiffField,
): { value: DiffRow['mine']; edited: boolean } => {
  const b = c.body;
  const mine: Partial<Record<DiffField, DiffRow['mine'] | undefined>> = {
    title: b.title,
    roomId: b.roomId,
    start: b.startAt,
    end: b.endAt,
    allDay: b.allDay,
    description: b.description,
    attendeeIds: b.attendeeIds ? [...b.attendeeIds].sort() : undefined,
  };
  const own = mine[f];
  return own === undefined
    ? { value: serverValue(e, f), edited: false }
    : { value: own, edited: true };
};

const same = (a: unknown, b: unknown) =>
  Array.isArray(a) && Array.isArray(b)
    ? a.length === b.length && a.every((v, i) => v === b[i])
    : a === b;

/**
 * The comparison shown on the conflict screen: for every field, my version next to the server's, with the
 * disagreements flagged. "My version" is the server's event with MY changes laid over it (we do not keep
 * the old base), so a row differs exactly where I changed something that now has another value. A delete
 * has no field-level "mine": every row is the event that would be deleted.
 */
export function diffRows(command: UpdateCommand | DeleteCommand, current: EventDto): DiffRow[] {
  return DIFF_FIELDS.map((field) => {
    const server = serverValue(current, field);
    if (command.kind === 'delete')
      return { field, mine: server, server, differs: false, changedByMe: false };
    const { value, edited } = mineValue(command, current, field);
    return {
      field,
      mine: value,
      server,
      differs: edited && !same(value, server),
      changedByMe: edited,
    };
  });
}

/** Rows that matter on the screen: the ones that differ, plus the ones I edited (so "no-op" edits are visible). */
export const interestingRows = (rows: DiffRow[]): DiffRow[] =>
  rows.filter((r) => r.differs || r.changedByMe);
