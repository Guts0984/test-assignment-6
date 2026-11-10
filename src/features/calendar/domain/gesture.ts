/**
 * The life of one pointer gesture on the grid, as a pure state machine (so it can be tested without a
 * browser). It answers the questions that make drag-and-drop feel right:
 *  - a click must not become a drag, and a tiny wobble while clicking must not move anything;
 *  - on a touch screen a finger that moves immediately is SCROLLING; only a press-and-hold picks
 *    something up (then scrolling must stop);
 *  - Escape or a cancelled pointer abandons the drag and changes nothing.
 */
export type GestureMode = 'create' | 'move' | 'resize';
export type PointerKind = 'mouse' | 'pen' | 'touch';

export type Gesture =
  | { phase: 'idle' }
  | { phase: 'pending'; mode: GestureMode; pointer: PointerKind; x: number; y: number }
  | { phase: 'dragging'; mode: GestureMode; pointer: PointerKind; x: number; y: number };

export type GestureInput =
  | { type: 'down'; mode: GestureMode; pointer: PointerKind; x: number; y: number }
  | { type: 'move'; x: number; y: number }
  | { type: 'up'; x: number; y: number }
  | { type: 'cancel' }
  | { type: 'escape' }
  /** The long-press timer fired. */
  | { type: 'hold' };

export type GestureEffect =
  | { type: 'none' }
  /** Ask the host to call `hold` after this many ms (touch press-and-hold). */
  | { type: 'start-hold-timer'; ms: number }
  | { type: 'cancel-hold-timer' }
  | { type: 'begin'; mode: GestureMode }
  | { type: 'update' }
  | { type: 'commit' }
  | { type: 'abort' }
  /** A press and release without dragging: a plain click / tap. */
  | { type: 'click' };

export const MOUSE_DRAG_THRESHOLD_PX = 4;
/** A touch that moves more than this before the hold fires is a scroll, not a drag. */
export const TOUCH_SCROLL_TOLERANCE_PX = 8;
export const TOUCH_HOLD_MS = 300;

export const idle: Gesture = { phase: 'idle' };
const none: GestureEffect = { type: 'none' };
const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);

export function step(
  state: Gesture,
  input: GestureInput,
): { state: Gesture; effect: GestureEffect } {
  switch (state.phase) {
    case 'idle':
      if (input.type !== 'down') return { state, effect: none };
      return {
        state: {
          phase: 'pending',
          mode: input.mode,
          pointer: input.pointer,
          x: input.x,
          y: input.y,
        },
        effect: input.pointer === 'touch' ? { type: 'start-hold-timer', ms: TOUCH_HOLD_MS } : none,
      };

    case 'pending': {
      switch (input.type) {
        case 'move': {
          const moved = distance(state, input);
          if (state.pointer === 'touch') {
            // Moving before the hold means the user is scrolling the page.
            return moved > TOUCH_SCROLL_TOLERANCE_PX
              ? { state: idle, effect: { type: 'cancel-hold-timer' } }
              : { state, effect: none };
          }
          return moved >= MOUSE_DRAG_THRESHOLD_PX
            ? {
                state: { ...state, phase: 'dragging', x: input.x, y: input.y },
                effect: { type: 'begin', mode: state.mode },
              }
            : { state, effect: none };
        }
        case 'hold':
          return state.pointer === 'touch'
            ? {
                state: { ...state, phase: 'dragging' },
                effect: { type: 'begin', mode: state.mode },
              }
            : { state, effect: none };
        case 'up':
          return {
            state: idle,
            effect: { type: 'click' },
          };
        case 'cancel':
        case 'escape':
          return {
            state: idle,
            effect: state.pointer === 'touch' ? { type: 'cancel-hold-timer' } : none,
          };
        default:
          return { state, effect: none };
      }
    }

    case 'dragging':
      switch (input.type) {
        case 'move':
          return { state: { ...state, x: input.x, y: input.y }, effect: { type: 'update' } };
        case 'up':
          return { state: idle, effect: { type: 'commit' } };
        case 'cancel':
        case 'escape':
          return { state: idle, effect: { type: 'abort' } };
        default:
          return { state, effect: none };
      }
  }
}
