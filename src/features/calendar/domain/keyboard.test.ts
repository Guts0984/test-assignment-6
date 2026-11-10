// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  initialCursor,
  isNavKey,
  moveCursor,
  stepDrag,
  type Cursor,
  type KeyboardDrag,
} from './keyboard';

const at = (columnIndex: number, minutes: number): Cursor => ({ columnIndex, minutes });

describe('moveCursor', () => {
  it('starts at 09:00 in the first column', () => {
    expect(initialCursor()).toEqual({ columnIndex: 0, minutes: 540 });
  });

  it('arrows move by one 15-minute slot or one column', () => {
    expect(moveCursor(at(2, 600), 'ArrowDown', 7)).toEqual(at(2, 615));
    expect(moveCursor(at(2, 600), 'ArrowUp', 7)).toEqual(at(2, 585));
    expect(moveCursor(at(2, 600), 'ArrowRight', 7)).toEqual(at(3, 600));
    expect(moveCursor(at(2, 600), 'ArrowLeft', 7)).toEqual(at(1, 600));
  });

  it('Page Up/Down jump an hour; Home/End jump to the first/last column', () => {
    expect(moveCursor(at(2, 600), 'PageDown', 7)).toEqual(at(2, 660));
    expect(moveCursor(at(2, 600), 'PageUp', 7)).toEqual(at(2, 540));
    expect(moveCursor(at(4, 600), 'Home', 7)).toEqual(at(0, 600));
    expect(moveCursor(at(4, 600), 'End', 7)).toEqual(at(6, 600));
  });

  it('never leaves the grid: the last slot is 23:45, the first 00:00, columns stay in range', () => {
    expect(moveCursor(at(0, 0), 'ArrowUp', 7)).toEqual(at(0, 0));
    expect(moveCursor(at(0, 0), 'ArrowLeft', 7)).toEqual(at(0, 0));
    expect(moveCursor(at(6, 1425), 'ArrowDown', 7)).toEqual(at(6, 1425));
    expect(moveCursor(at(6, 1425), 'ArrowRight', 7)).toEqual(at(6, 1425));
    expect(moveCursor(at(0, 1400), 'PageDown', 7).minutes).toBe(1425);
  });

  it('works with a single column and with 50 (the day view)', () => {
    expect(moveCursor(at(0, 600), 'ArrowRight', 1)).toEqual(at(0, 600));
    expect(moveCursor(at(10, 600), 'End', 50).columnIndex).toBe(49);
  });

  it('every slot of the day is reachable with ArrowDown from 00:00', () => {
    let c = at(0, 0);
    const seen = new Set([c.minutes]);
    for (let i = 0; i < 200; i += 1) {
      c = moveCursor(c, 'ArrowDown', 1);
      seen.add(c.minutes);
    }
    expect(seen.size).toBe(96);
  });

  it('recognises navigation keys only', () => {
    expect(isNavKey('ArrowUp')).toBe(true);
    expect(isNavKey('Enter')).toBe(false);
    expect(isNavKey('a')).toBe(false);
  });
});

describe('stepDrag (picked-up event)', () => {
  const d: KeyboardDrag = { columnIndex: 2, startMin: 600, endMin: 660 };

  it('arrows move it, keeping the duration', () => {
    expect(stepDrag(d, 'ArrowDown', false, 7)).toEqual({
      columnIndex: 2,
      startMin: 615,
      endMin: 675,
    });
    expect(stepDrag(d, 'ArrowUp', false, 7)).toEqual({
      columnIndex: 2,
      startMin: 585,
      endMin: 645,
    });
    expect(stepDrag(d, 'ArrowRight', false, 7)).toEqual({
      columnIndex: 3,
      startMin: 600,
      endMin: 660,
    });
    expect(stepDrag(d, 'PageDown', false, 7)).toEqual({
      columnIndex: 2,
      startMin: 660,
      endMin: 720,
    });
  });

  it('Shift+Up/Down changes the length by one slot, moving only the end', () => {
    expect(stepDrag(d, 'ArrowDown', true, 7)).toEqual({
      columnIndex: 2,
      startMin: 600,
      endMin: 675,
    });
    expect(stepDrag(d, 'ArrowUp', true, 7)).toEqual({ columnIndex: 2, startMin: 600, endMin: 645 });
  });

  it('cannot shrink below one slot or grow past midnight', () => {
    let shrunk = d;
    for (let i = 0; i < 10; i += 1) shrunk = stepDrag(shrunk, 'ArrowUp', true, 7);
    expect(shrunk.endMin - shrunk.startMin).toBe(15);
    let grown = d;
    for (let i = 0; i < 200; i += 1) grown = stepDrag(grown, 'ArrowDown', true, 7);
    expect(grown.endMin).toBe(1440);
    expect(grown.startMin).toBe(600);
  });

  it('a move stops at the day edges and never changes the duration (also for an odd length)', () => {
    const odd: KeyboardDrag = { columnIndex: 0, startMin: 10, endMin: 70 };
    expect(stepDrag(odd, 'ArrowUp', false, 7).startMin).toBe(0);
    const top = stepDrag({ columnIndex: 0, startMin: 0, endMin: 60 }, 'ArrowUp', false, 7);
    expect(top).toEqual({ columnIndex: 0, startMin: 0, endMin: 60 });
    const late = stepDrag({ columnIndex: 0, startMin: 1380, endMin: 1440 }, 'ArrowDown', false, 7);
    expect(late).toEqual({ columnIndex: 0, startMin: 1380, endMin: 1440 });
    let ride = { columnIndex: 0, startMin: 1000, endMin: 1090 };
    for (let i = 0; i < 100; i += 1) ride = stepDrag(ride, 'ArrowDown', false, 7);
    expect(ride.endMin - ride.startMin).toBe(90);
    expect(ride.endMin).toBe(1440);
  });

  it('moves between columns (days in the week view, rooms in the day view) within bounds', () => {
    expect(stepDrag({ ...d, columnIndex: 0 }, 'ArrowLeft', false, 7).columnIndex).toBe(0);
    expect(stepDrag({ ...d, columnIndex: 6 }, 'ArrowRight', false, 7).columnIndex).toBe(6);
  });

  it('other keys change nothing', () => {
    expect(stepDrag(d, 'x', false, 7)).toBe(d);
    expect(stepDrag(d, 'Enter', true, 7)).toBe(d);
    expect(stepDrag(d, 'ArrowLeft', true, 7).columnIndex).toBe(1); // shift+left still moves (only vertical shift = resize)
  });
});
