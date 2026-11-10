'use client';

import {
  useCallback,
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import {
  type Gesture,
  type GestureInput,
  type GestureMode,
  type PointerKind,
  idle,
  step,
} from '../domain/gesture';
import { createTarget, locate, moveTarget, resizeTarget } from '../domain/pointer';
import type { Segment } from '../domain/segments';
import { useUi } from '../state/ui-store';
import { PX_PER_HOUR } from './EventBlock';
import type { GridColumn } from './TimeGrid';

export type GridPointerHandlers = {
  /** A press on an empty slot was dragged out into a range. */
  onCreate: (column: GridColumn, startMin: number, endMin: number) => void;
  /** An event was dropped on `column` at `startMin`. */
  onMove: (segment: Segment, column: GridColumn, startMin: number) => void;
  onResize: (segment: Segment, column: GridColumn, endMin: number) => void;
  onActivate: (key: string) => void;
};

type Props = {
  containerRef: RefObject<HTMLElement | null>;
  columns: readonly GridColumn[];
} & GridPointerHandlers;

const kindOf = (e: ReactPointerEvent): PointerKind =>
  e.pointerType === 'touch' ? 'touch' : e.pointerType === 'pen' ? 'pen' : 'mouse';

/**
 * Create / move / resize by pointer (mouse, pen, touch). The decisions (click vs drag, scroll vs
 * press-and-hold, Escape) live in the pure `gesture` machine; this hook only reads coordinates, feeds the
 * machine, and turns its effects into store updates and callbacks. The preview is drawn from the store,
 * so only the column under the pointer re-renders while dragging.
 */
export function useGridPointer(props: Props): (e: ReactPointerEvent<HTMLElement>) => void {
  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  });

  return useCallback((down: ReactPointerEvent<HTMLElement>) => {
    if (down.pointerType === 'mouse' && down.button !== 0) return;
    const target = down.target as HTMLElement;
    const block = target.closest<HTMLElement>('.event-block[data-key]');
    const columnEl = target.closest<HTMLElement>('[data-column-id]');
    if (block && block.dataset.allday === 'true') return; // all-day blocks: click only
    if (!block && !columnEl) return;
    const container = latest.current.containerRef.current;
    if (!container || !columnEl) return;

    const mode: GestureMode = target.closest('[data-handle="resize"]')
      ? 'resize'
      : block
        ? 'move'
        : 'create';
    const pointer = kindOf(down);
    const ui = useUi.getState();

    const columns = () => latest.current.columns;
    const columnIndex = columns().findIndex((c) => c.id === columnEl.dataset.columnId);
    if (columnIndex < 0) return;
    const segment: Segment | undefined = block
      ? columns()[columnIndex]?.timed.find((s) => s.event.key === block.dataset.key)
      : undefined;
    if (block && !segment) return;

    const where = (x: number, y: number) => {
      const first = container
        .querySelector<HTMLElement>('[data-column-id]')!
        .getBoundingClientRect();
      return locate({
        clientX: x,
        clientY: y,
        firstColumn: { left: first.left, top: first.top, width: first.width },
        columnCount: columns().length,
        pxPerHour: PX_PER_HOUR,
      });
    };
    const start = where(down.clientX, down.clientY);
    const grabOffset = segment ? start.minutes - segment.startMin : 0;
    const duration = segment ? segment.endMin - segment.startMin : 0;

    let state: Gesture = idle;
    let holdTimer: number | undefined;
    let frame: number | undefined;
    let last = { x: down.clientX, y: down.clientY };
    let preview: { column: GridColumn; startMin: number; endMin: number } | null = null;

    const compute = () => {
      const loc = where(last.x, last.y);
      const anchorColumn = columns()[columnIndex] as GridColumn;
      if (mode === 'create') {
        const { start: s, end: e } = createTarget(start.minutes, loc.minutes);
        preview = { column: anchorColumn, startMin: s, endMin: e };
      } else if (mode === 'move' && segment) {
        const { startMin, endMin } = moveTarget({
          pointerMin: loc.minutes,
          grabOffsetMin: grabOffset,
          durationMin: duration,
        });
        preview = { column: columns()[loc.columnIndex] as GridColumn, startMin, endMin };
      } else if (segment) {
        const { endMin } = resizeTarget({ pointerMin: loc.minutes, startMin: segment.startMin });
        preview = { column: anchorColumn, startMin: segment.startMin, endMin };
      }
      if (preview) {
        useUi.getState().setDrag({
          mode,
          key: segment?.event.key ?? null,
          columnId: preview.column.id,
          date: preview.column.date,
          startMin: preview.startMin,
          endMin: preview.endMin,
          roomId: preview.column.roomId ?? null,
        });
      }
    };
    const schedule = () => {
      if (frame === undefined)
        frame = requestAnimationFrame(() => {
          frame = undefined;
          compute();
        });
    };

    const stopTouchScroll = (e: TouchEvent) => e.preventDefault();
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('touchmove', stopTouchScroll);
      if (holdTimer !== undefined) clearTimeout(holdTimer);
      if (frame !== undefined) cancelAnimationFrame(frame);
      useUi.getState().setDrag(null);
    };

    const feed = (input: GestureInput) => {
      const r = step(state, input);
      state = r.state;
      const effect = r.effect;
      switch (effect.type) {
        case 'start-hold-timer':
          holdTimer = window.setTimeout(() => feed({ type: 'hold' }), effect.ms);
          break;
        case 'cancel-hold-timer':
          if (holdTimer !== undefined) clearTimeout(holdTimer);
          cleanup();
          break;
        case 'begin':
          window.addEventListener('touchmove', stopTouchScroll, { passive: false });
          if (block) useUi.getState().select(block.dataset.key ?? null);
          compute();
          break;
        case 'update':
          schedule();
          break;
        case 'commit': {
          compute(); // use the final pointer position
          const done = preview;
          cleanup();
          if (!done) break;
          if (mode === 'create') latest.current.onCreate(done.column, done.startMin, done.endMin);
          else if (mode === 'move' && segment)
            latest.current.onMove(segment, done.column, done.startMin);
          else if (segment) latest.current.onResize(segment, done.column, done.endMin);
          break;
        }
        case 'abort':
          cleanup();
          break;
        case 'click':
          cleanup();
          if (block?.dataset.key) latest.current.onActivate(block.dataset.key);
          else ui.select(null);
          break;
        default:
          break;
      }
      if (state.phase === 'idle' && effect.type === 'none') cleanup();
    };

    const onMove = (e: PointerEvent) => {
      last = { x: e.clientX, y: e.clientY };
      feed({ type: 'move', x: e.clientX, y: e.clientY });
    };
    const onUp = (e: PointerEvent) => {
      last = { x: e.clientX, y: e.clientY };
      feed({ type: 'up', x: e.clientX, y: e.clientY });
    };
    const onCancel = () => feed({ type: 'cancel' });
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && feed({ type: 'escape' });

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey);
    feed({ type: 'down', mode, pointer, x: down.clientX, y: down.clientY });
  }, []);
}
