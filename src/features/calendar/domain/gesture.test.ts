// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  idle,
  MOUSE_DRAG_THRESHOLD_PX,
  step,
  TOUCH_HOLD_MS,
  TOUCH_SCROLL_TOLERANCE_PX,
  type Gesture,
  type GestureInput,
} from './gesture';

/** Runs inputs through the machine and returns the effects (without 'none'). */
function run(inputs: GestureInput[], from: Gesture = idle) {
  let state = from;
  const effects: string[] = [];
  for (const input of inputs) {
    const r = step(state, input);
    state = r.state;
    if (r.effect.type !== 'none') effects.push(r.effect.type);
  }
  return { state, effects };
}
const down = (
  pointer: 'mouse' | 'touch' | 'pen' = 'mouse',
  mode: 'create' | 'move' | 'resize' = 'move',
  x = 100,
  y = 100,
): GestureInput => ({ type: 'down', mode, pointer, x, y });

describe('mouse', () => {
  it('press and release without moving is a click, not a drag', () => {
    expect(run([down(), { type: 'up', x: 100, y: 100 }]).effects).toEqual(['click']);
  });

  it('a wobble under the threshold while clicking does not start a drag', () => {
    const r = run([
      down(),
      { type: 'move', x: 100 + MOUSE_DRAG_THRESHOLD_PX - 1, y: 100 },
      { type: 'up', x: 103, y: 100 },
    ]);
    expect(r.effects).toEqual(['click']);
  });

  it('moving past the threshold begins the drag exactly once, then updates, then commits on release', () => {
    const r = run([
      down('mouse', 'create'),
      { type: 'move', x: 110, y: 100 },
      { type: 'move', x: 120, y: 130 },
      { type: 'move', x: 130, y: 160 },
      { type: 'up', x: 130, y: 160 },
    ]);
    expect(r.effects).toEqual(['begin', 'update', 'update', 'commit']);
    expect(r.state).toEqual(idle);
  });

  it('the threshold is a distance, so a diagonal move counts', () => {
    expect(run([down(), { type: 'move', x: 103, y: 103 }]).effects).toEqual(['begin']); // sqrt(18) > 4
  });

  it('Escape or a cancelled pointer during a drag aborts it, and the later release does nothing', () => {
    expect(
      run([
        down(),
        { type: 'move', x: 150, y: 150 },
        { type: 'escape' },
        { type: 'up', x: 150, y: 150 },
      ]).effects,
    ).toEqual(['begin', 'abort']);
    expect(
      run([
        down(),
        { type: 'move', x: 150, y: 150 },
        { type: 'cancel' },
        { type: 'up', x: 150, y: 150 },
      ]).effects,
    ).toEqual(['begin', 'abort']);
  });

  it('Escape before the drag started just drops the press (no click afterwards)', () => {
    expect(run([down(), { type: 'escape' }, { type: 'up', x: 100, y: 100 }]).effects).toEqual([]);
  });

  it('pen behaves like a mouse', () => {
    expect(
      run([down('pen'), { type: 'move', x: 120, y: 100 }, { type: 'up', x: 120, y: 100 }]).effects,
    ).toEqual(['begin', 'commit']);
  });

  it('carries the mode through to begin', () => {
    const r = step(step(idle, down('mouse', 'resize')).state, { type: 'move', x: 200, y: 100 });
    expect(r.effect).toEqual({ type: 'begin', mode: 'resize' });
  });
});

describe('touch', () => {
  it('asks for a press-and-hold timer on touch down, and a hold begins the drag', () => {
    const r = step(idle, down('touch'));
    expect(r.effect).toEqual({ type: 'start-hold-timer', ms: TOUCH_HOLD_MS });
    expect(
      run([
        down('touch'),
        { type: 'hold' },
        { type: 'move', x: 100, y: 180 },
        { type: 'up', x: 100, y: 180 },
      ]).effects,
    ).toEqual(['start-hold-timer', 'begin', 'update', 'commit']);
  });

  it('a finger that moves before the hold is SCROLLING: the gesture is dropped and the timer cancelled', () => {
    const r = run([
      down('touch'),
      { type: 'move', x: 100, y: 100 + TOUCH_SCROLL_TOLERANCE_PX + 1 },
      { type: 'hold' },
      { type: 'up', x: 100, y: 200 },
    ]);
    expect(r.effects).toEqual(['start-hold-timer', 'cancel-hold-timer']);
    expect(r.state).toEqual(idle);
  });

  it('a small jitter of a resting finger does not cancel the hold', () => {
    const r = run([down('touch'), { type: 'move', x: 103, y: 102 }, { type: 'hold' }]);
    expect(r.effects).toEqual(['start-hold-timer', 'begin']);
  });

  it('a quick tap (release before the hold) is a click', () => {
    expect(run([down('touch'), { type: 'up', x: 100, y: 100 }]).effects).toEqual([
      'start-hold-timer',
      'click',
    ]);
  });

  it('touch does NOT start a drag from movement alone, however far', () => {
    expect(run([down('touch'), { type: 'move', x: 100, y: 108 }]).effects).not.toContain('begin');
  });

  it('a late hold timer after the gesture ended is ignored', () => {
    expect(run([down('touch'), { type: 'up', x: 100, y: 100 }, { type: 'hold' }]).effects).toEqual([
      'start-hold-timer',
      'click',
    ]);
  });

  it('a pointercancel while waiting for the hold cancels the timer', () => {
    expect(run([down('touch'), { type: 'cancel' }]).effects).toEqual([
      'start-hold-timer',
      'cancel-hold-timer',
    ]);
  });
});

describe('robustness', () => {
  it('stray inputs while idle are ignored', () => {
    expect(
      run([
        { type: 'move', x: 1, y: 1 },
        { type: 'up', x: 1, y: 1 },
        { type: 'escape' },
        { type: 'hold' },
        { type: 'cancel' },
      ]).effects,
    ).toEqual([]);
  });

  it('a second down while a gesture is running does not start another (multi-touch / double press)', () => {
    const r = run([
      down('mouse'),
      { type: 'move', x: 150, y: 100 },
      down('mouse', 'create', 5, 5),
      { type: 'up', x: 150, y: 100 },
    ]);
    expect(r.effects).toEqual(['begin', 'commit']);
  });

  it('can be used again right after a gesture ends', () => {
    const r = run([
      down(),
      { type: 'move', x: 150, y: 100 },
      { type: 'up', x: 150, y: 100 },
      down(),
      { type: 'up', x: 100, y: 100 },
    ]);
    expect(r.effects).toEqual(['begin', 'commit', 'click']);
  });
});
