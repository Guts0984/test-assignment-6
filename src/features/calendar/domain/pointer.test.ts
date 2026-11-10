// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createTarget, locate, moveTarget, resizeTarget } from './pointer';

const first = { left: 100, top: 50, width: 120 };
const at = (clientX: number, clientY: number, columnCount = 7) =>
  locate({ clientX, clientY, firstColumn: first, columnCount, pxPerHour: 48 });

describe('locate', () => {
  it('finds the column and the minutes under the pointer', () => {
    expect(at(100, 50)).toEqual({ columnIndex: 0, minutes: 0 });
    expect(at(219, 50 + 48)).toEqual({ columnIndex: 0, minutes: 60 }); // last pixel of column 0, one hour down
    expect(at(220, 50 + 24)).toEqual({ columnIndex: 1, minutes: 30 });
    expect(at(100 + 120 * 3 + 5, 50 + 48 * 9.5).columnIndex).toBe(3);
    expect(at(100 + 120 * 3 + 5, 50 + 48 * 9.5).minutes).toBe(570);
  });

  it('clamps: left of the grid is the first column, right of it the last, above/below stay in the day', () => {
    expect(at(0, 50).columnIndex).toBe(0);
    expect(at(10_000, 50).columnIndex).toBe(6);
    expect(at(150, 0).minutes).toBe(0);
    expect(at(150, 50 + 48 * 30).minutes).toBe(1440);
  });

  it('follows scrolling because the first column rectangle is read from the viewport', () => {
    const scrolled = locate({
      clientX: 150,
      clientY: 100,
      firstColumn: { left: 100, top: 50 - 48 * 7, width: 120 },
      columnCount: 7,
      pxPerHour: 48,
    });
    expect(scrolled.minutes).toBeCloseTo(((100 - (50 - 48 * 7)) * 60) / 48, 6);
  });
});

describe('moveTarget', () => {
  it('keeps the grabbed spot under the pointer and snaps the start to 15 minutes', () => {
    // grabbed 20 minutes below the top of a 60-minute event; pointer at 10:07 -> top would be 09:47 -> 09:45
    expect(moveTarget({ pointerMin: 10 * 60 + 7, grabOffsetMin: 20, durationMin: 60 })).toEqual({
      startMin: 9 * 60 + 45,
      endMin: 10 * 60 + 45,
    });
  });

  it('never leaves the day: clamps to 00:00 and so that the end is at most 24:00', () => {
    expect(moveTarget({ pointerMin: 5, grabOffsetMin: 30, durationMin: 60 })).toEqual({
      startMin: 0,
      endMin: 60,
    });
    expect(moveTarget({ pointerMin: 1430, grabOffsetMin: 0, durationMin: 120 })).toEqual({
      startMin: 1320,
      endMin: 1440,
    });
  });

  it('keeps the duration exactly, also when it is not a multiple of 15', () => {
    const t = moveTarget({ pointerMin: 600, grabOffsetMin: 0, durationMin: 50 });
    expect(t.endMin - t.startMin).toBe(50);
  });

  it('a very long event stays within the day', () => {
    expect(moveTarget({ pointerMin: 600, grabOffsetMin: 0, durationMin: 2000 })).toEqual({
      startMin: 0,
      endMin: 1440,
    });
  });
});

describe('resizeTarget', () => {
  it('end follows the pointer, rounded UP to the grid so the grabbed edge is never short of the pointer', () => {
    expect(resizeTarget({ pointerMin: 11 * 60 + 1, startMin: 540 })).toEqual({
      endMin: 11 * 60 + 15,
    });
    expect(resizeTarget({ pointerMin: 11 * 60, startMin: 540 })).toEqual({ endMin: 11 * 60 });
  });

  it('is at least one slot long, even if dragged above the start', () => {
    expect(resizeTarget({ pointerMin: 400, startMin: 540 })).toEqual({ endMin: 555 });
  });

  it('cannot go past midnight', () => {
    expect(resizeTarget({ pointerMin: 1439, startMin: 1000 })).toEqual({ endMin: 1440 });
  });
});

describe('createTarget', () => {
  it('works in either direction and snaps outward', () => {
    expect(createTarget(545, 610)).toEqual({ start: 540, end: 615 });
    expect(createTarget(610, 545)).toEqual({ start: 540, end: 615 });
  });
});
