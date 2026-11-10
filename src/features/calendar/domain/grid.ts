/** Vertical time-grid math. Everything is in minutes since local midnight. */
export const SLOT_MINUTES = 15;
export const MINUTES_PER_DAY = 24 * 60;

export type SnapMode = 'round' | 'floor' | 'ceil';

export function snapMinutes(
  minutes: number,
  step = SLOT_MINUTES,
  mode: SnapMode = 'round',
): number {
  const q = minutes / step;
  const n = mode === 'floor' ? Math.floor(q) : mode === 'ceil' ? Math.ceil(q) : Math.round(q);
  return n * step;
}

export const clampMinutes = (minutes: number, min = 0, max = MINUTES_PER_DAY): number =>
  Math.min(max, Math.max(min, minutes));

export const minutesToPx = (minutes: number, pxPerHour: number): number =>
  (minutes * pxPerHour) / 60;

export const pxToMinutes = (px: number, pxPerHour: number): number => (px * 60) / pxPerHour;

/** A drag-created range: the two ends in any order become an ordered, snapped, at-least-one-slot range. */
export function dragRange(
  aMin: number,
  bMin: number,
  step = SLOT_MINUTES,
): { start: number; end: number } {
  const lo = clampMinutes(snapMinutes(Math.min(aMin, bMin), step, 'floor'));
  const hi = clampMinutes(snapMinutes(Math.max(aMin, bMin), step, 'ceil'));
  return hi - lo >= step
    ? { start: lo, end: hi }
    : { start: lo, end: Math.min(MINUTES_PER_DAY, lo + step) };
}
