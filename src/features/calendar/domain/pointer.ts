import { MINUTES_PER_DAY, SLOT_MINUTES, clampMinutes, dragRange, snapMinutes } from './grid';

/** Where is the pointer on the grid? Columns are equally wide, so this is plain arithmetic. */
export function locate(args: {
  clientX: number;
  clientY: number;
  /** Viewport rectangle of the FIRST column (so scrolling is already accounted for). */
  firstColumn: { left: number; top: number; width: number };
  columnCount: number;
  pxPerHour: number;
}): { columnIndex: number; minutes: number } {
  const { clientX, clientY, firstColumn, columnCount, pxPerHour } = args;
  const raw = Math.floor((clientX - firstColumn.left) / firstColumn.width);
  const columnIndex = Math.min(columnCount - 1, Math.max(0, raw));
  const minutes = ((clientY - firstColumn.top) * 60) / pxPerHour;
  return { columnIndex, minutes: clampMinutes(minutes) };
}

/**
 * Moving: the event keeps the spot where it was grabbed under the pointer (grab offset), its start snaps
 * to the 15-minute grid, and it stays inside the day.
 */
export function moveTarget(args: {
  pointerMin: number;
  grabOffsetMin: number;
  durationMin: number;
  step?: number;
}): { startMin: number; endMin: number } {
  const step = args.step ?? SLOT_MINUTES;
  const raw = snapMinutes(args.pointerMin - args.grabOffsetMin, step, 'round');
  const duration = Math.min(args.durationMin, MINUTES_PER_DAY);
  const startMin = Math.min(Math.max(0, raw), MINUTES_PER_DAY - duration);
  return { startMin, endMin: startMin + duration };
}

/** Resizing: the end follows the pointer, snapped, at least one step after the start, at most midnight. */
export function resizeTarget(args: { pointerMin: number; startMin: number; step?: number }): {
  endMin: number;
} {
  const step = args.step ?? SLOT_MINUTES;
  const snapped = snapMinutes(args.pointerMin, step, 'ceil');
  return { endMin: Math.min(MINUTES_PER_DAY, Math.max(args.startMin + step, snapped)) };
}

/** Creating: from where the drag began to where the pointer is now. */
export const createTarget = (anchorMin: number, pointerMin: number) =>
  dragRange(anchorMin, pointerMin);
