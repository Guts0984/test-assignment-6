'use client';

import {
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from 'react';
import { initialCursor, isNavKey, moveCursor, stepDrag } from '../domain/keyboard';
import type { Segment } from '../domain/segments';
import { useUi } from '../state/ui-store';
import { PX_PER_HOUR } from './EventBlock';
import type { GridColumn } from './TimeGrid';

export type Describe = (
  columnIndex: number,
  minutes: number,
) => { day: string; time: string; room?: string };
export type Say = (
  code: 'pickedUp' | 'dragPosition' | 'dropped' | 'dragCancelled' | 'cursor' | 'cursorRoom',
  params: Record<string, string>,
) => void;

type Props = {
  containerRef: RefObject<HTMLElement | null>;
  columns: readonly GridColumn[];
  describe: Describe;
  say: Say;
  /** Dropped after being picked up: the final column and times. */
  onChange: (segment: Segment, column: GridColumn, startMin: number, endMin: number) => void;
  onOpenEvent: (key: string) => void;
  onCreateAt: (column: GridColumn, startMin: number, endMin: number) => void;
};

/**
 * Keyboard operation of the grid (assignment §6):
 *  - on the grid: arrows move a slot cursor, Enter creates an event there;
 *  - on an event: Enter opens it, Space picks it up, arrows move it, Shift+Up/Down resizes,
 *    Space/Enter drops it, Escape puts it back.
 * Every step is announced for screen readers.
 */
export function useGridKeyboard(props: Props): (e: ReactKeyboardEvent<HTMLElement>) => void {
  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  });

  return useCallback((e: ReactKeyboardEvent<HTMLElement>) => {
    const { columns, describe, say, containerRef } = latest.current;
    const ui = useUi.getState();
    const block = (e.target as HTMLElement).closest<HTMLElement>('.event-block[data-key]');
    const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName);
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;

    // ---- an event is focused ----
    if (block && block.dataset.allday !== 'true') {
      const key = block.dataset.key as string;
      const columnIndex = columns.findIndex((c) => c.timed.some((s) => s.event.key === key));
      const column = columns[columnIndex];
      const segment = column?.timed.find((s) => s.event.key === key);
      if (!column || !segment) return;
      const drag = ui.drag;

      if (drag?.key === key && drag.kbd) {
        if (e.key === 'Escape') {
          e.preventDefault();
          ui.setDrag(null);
          say('dragCancelled', {});
        } else if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          const target = columns.find((c) => c.id === drag.columnId) ?? column;
          ui.setDrag(null);
          const d = describe(columns.indexOf(target), drag.startMin);
          say('dropped', { title: segment.event.title, day: d.day, time: d.time });
          latest.current.onChange(segment, target, drag.startMin, drag.endMin);
        } else if (isNavKey(e.key) || e.key === 'PageUp' || e.key === 'PageDown') {
          e.preventDefault();
          const idx = columns.findIndex((c) => c.id === drag.columnId);
          const next = stepDrag(
            { columnIndex: idx, startMin: drag.startMin, endMin: drag.endMin },
            e.key,
            e.shiftKey,
            columns.length,
          );
          const target = columns[next.columnIndex] as GridColumn;
          ui.setDrag({
            ...drag,
            columnId: target.id,
            date: target.date,
            startMin: next.startMin,
            endMin: next.endMin,
            roomId: target.roomId ?? null,
          });
          const d = describe(next.columnIndex, next.startMin);
          say('dragPosition', { day: d.day, time: d.time, ...(d.room ? { room: d.room } : {}) });
        }
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        latest.current.onOpenEvent(key);
      } else if (e.key === ' ') {
        e.preventDefault();
        ui.setDrag({
          mode: 'move',
          key,
          columnId: column.id,
          date: column.date,
          startMin: segment.startMin,
          endMin: segment.endMin,
          roomId: column.roomId ?? null,
          kbd: true,
        });
        say('pickedUp', { title: segment.event.title });
      }
      return;
    }

    // ---- the grid itself is focused: the slot cursor ----
    if (e.target !== containerRef.current) return;
    if (isNavKey(e.key)) {
      e.preventDefault();
      const next = moveCursor(ui.cursor ?? initialCursor(), e.key, columns.length);
      ui.setCursor(next);
      const d = describe(next.columnIndex, next.minutes);
      say(d.room ? 'cursorRoom' : 'cursor', {
        day: d.day,
        time: d.time,
        ...(d.room ? { room: d.room } : {}),
      });
      // keep the cursor in view
      const el = containerRef.current;
      if (el) {
        const y = (next.minutes * PX_PER_HOUR) / 60;
        const view = el.clientHeight - 110;
        if (y < el.scrollTop) el.scrollTop = Math.max(0, y - 40);
        else if (y > el.scrollTop + view) el.scrollTop = y - view + 40;
      }
    } else if (e.key === 'Enter' && ui.cursor) {
      e.preventDefault();
      const column = columns[ui.cursor.columnIndex];
      if (column)
        latest.current.onCreateAt(
          column,
          ui.cursor.minutes,
          Math.min(1440, ui.cursor.minutes + 60),
        );
    } else if (e.key === 'Escape') {
      ui.setCursor(null);
    }
  }, []);
}
