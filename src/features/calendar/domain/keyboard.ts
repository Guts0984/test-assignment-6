import { MINUTES_PER_DAY, SLOT_MINUTES } from './grid';

export type NavKey =
  'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'PageUp' | 'PageDown' | 'Home' | 'End';
export const NAV_KEYS: readonly string[] = [
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'PageUp',
  'PageDown',
  'Home',
  'End',
];
export const isNavKey = (key: string): key is NavKey => NAV_KEYS.includes(key);

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** The keyboard cursor: a slot on the grid (which column, which 15-minute row). */
export type Cursor = { columnIndex: number; minutes: number };

export const WORKDAY_START = 9 * 60;
export const initialCursor = (columnIndex = 0): Cursor => ({ columnIndex, minutes: WORKDAY_START });

/**
 * Arrow keys move the cursor by one slot or one column, Page Up/Down by an hour, Home/End jump to the
 * first/last column. The cursor stays on the grid (the last slot starts at 23:45).
 */
export function moveCursor(c: Cursor, key: NavKey, columnCount: number): Cursor {
  const lastSlot = MINUTES_PER_DAY - SLOT_MINUTES;
  const last = Math.max(0, columnCount - 1);
  switch (key) {
    case 'ArrowUp':
      return { ...c, minutes: clamp(c.minutes - SLOT_MINUTES, 0, lastSlot) };
    case 'ArrowDown':
      return { ...c, minutes: clamp(c.minutes + SLOT_MINUTES, 0, lastSlot) };
    case 'PageUp':
      return { ...c, minutes: clamp(c.minutes - 60, 0, lastSlot) };
    case 'PageDown':
      return { ...c, minutes: clamp(c.minutes + 60, 0, lastSlot) };
    case 'ArrowLeft':
      return { ...c, columnIndex: clamp(c.columnIndex - 1, 0, last) };
    case 'ArrowRight':
      return { ...c, columnIndex: clamp(c.columnIndex + 1, 0, last) };
    case 'Home':
      return { ...c, columnIndex: 0 };
    case 'End':
      return { ...c, columnIndex: last };
  }
}

/** An event being moved or resized with the keyboard. */
export type KeyboardDrag = { columnIndex: number; startMin: number; endMin: number };

/**
 * While an event is picked up: arrows move it (15 minutes / one column), Shift+Up/Down changes its
 * length (the end moves, at least one slot, at most midnight). A move keeps the duration and stays in
 * the day. Keys that mean nothing here return the same drag.
 */
export function stepDrag(
  d: KeyboardDrag,
  key: string,
  shift: boolean,
  columnCount: number,
): KeyboardDrag {
  const duration = d.endMin - d.startMin;
  const last = Math.max(0, columnCount - 1);
  if (shift && (key === 'ArrowUp' || key === 'ArrowDown')) {
    const endMin = clamp(
      d.endMin + (key === 'ArrowDown' ? SLOT_MINUTES : -SLOT_MINUTES),
      d.startMin + SLOT_MINUTES,
      MINUTES_PER_DAY,
    );
    return { ...d, endMin };
  }
  switch (key) {
    case 'ArrowUp':
    case 'ArrowDown': {
      const startMin = clamp(
        d.startMin + (key === 'ArrowDown' ? SLOT_MINUTES : -SLOT_MINUTES),
        0,
        MINUTES_PER_DAY - duration,
      );
      return { ...d, startMin, endMin: startMin + duration };
    }
    case 'PageUp':
    case 'PageDown': {
      const startMin = clamp(
        d.startMin + (key === 'PageDown' ? 60 : -60),
        0,
        MINUTES_PER_DAY - duration,
      );
      return { ...d, startMin, endMin: startMin + duration };
    }
    case 'ArrowLeft':
      return { ...d, columnIndex: clamp(d.columnIndex - 1, 0, last) };
    case 'ArrowRight':
      return { ...d, columnIndex: clamp(d.columnIndex + 1, 0, last) };
    default:
      return d;
  }
}
