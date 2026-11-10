'use client';

import { memo, type CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import { timeRange } from '../format';
import { roomHue } from '../format';
import { minutesToPx } from '../domain/grid';
import type { Segment } from '../domain/segments';
import { useEnv } from '../context';
import { useUi } from '../state/ui-store';

export const PX_PER_HOUR = 48;
/**
 * Short events are drawn at least this tall so their title stays readable and they stay clickable
 * (24 px is the WCAG 2.2 minimum size of a pointer target).
 */
export const MIN_BLOCK_PX = 24;
/** ...which is this many minutes of the grid: the column layout treats the block as that long. */
export const MIN_BLOCK_MINUTES = (MIN_BLOCK_PX * 60) / PX_PER_HOUR;

export type Placement = { col: number; span: number; cols: number };

type Props = {
  segment: Segment;
  /** Where the block sits among overlapping events in its column. Omit for static (all-day) blocks. */
  placement?: Placement;
  roomName: string;
  showRoom?: boolean;
};

/**
 * One event on the grid. Memoized on plain values, so dragging or editing one event never re-renders
 * the others (assignment: "dragging does not repaint the whole grid").
 */
export const EventBlock = memo(
  function EventBlock({ segment, placement, roomName, showRoom }: Props) {
    const { tz, clock, names } = useEnv();
    const t = useTranslations('calendar');
    const { event } = segment;
    // Selecting or dragging re-renders only the affected block, thanks to these narrow selectors.
    const selected = useUi((s) => s.selectedKey === event.key);
    const dragging = useUi((s) => s.drag?.key === event.key);
    const hue = roomHue(event.roomId);
    const times = event.allDay
      ? t('allDay')
      : timeRange(event.start, event.end, tz, clock, names.time);

    const style: CSSProperties & { '--hue': number } = { '--hue': hue };
    if (placement && !event.allDay) {
      style.top = minutesToPx(segment.startMin, PX_PER_HOUR);
      style.height = Math.max(
        MIN_BLOCK_PX,
        minutesToPx(segment.endMin - segment.startMin, PX_PER_HOUR) - 1,
      );
      style.left = `calc(${(placement.col / placement.cols) * 100}% + 1px)`;
      style.width = `calc(${(placement.span / placement.cols) * 100}% - 3px)`;
    }
    const short = segment.endMin - segment.startMin < 40;

    return (
      <button
        type="button"
        className="event-block"
        style={style}
        data-key={event.key}
        data-event-id={event.eventId}
        data-sync={event.sync}
        data-selected={selected ? 'true' : undefined}
        data-dragging={dragging ? 'true' : undefined}
        data-allday={event.allDay || !placement ? 'true' : undefined}
        aria-pressed={selected}
        onFocus={() => useUi.getState().select(event.key)}
      >
        <span className="font-semibold">
          {event.recurring && <span aria-hidden="true">↻ </span>}
          {short && !event.allDay ? `${times.split(' – ')[0]} ` : ''}
          {event.title || t('untitled')}
        </span>
        {!short && !event.allDay && (
          <span className="block opacity-80">
            {times}
            {showRoom ? ` · ${roomName}` : ''}
          </span>
        )}
        {/* The visible text is the accessible name (WCAG 2.5.3); the rest is read after it. */}
        <span className="sr-only">
          {(short || event.allDay) && `, ${times}`}
          {(!showRoom || short || event.allDay) && `, ${roomName}`},{' '}
          {t('createdBy', { name: event.creatorName })}
        </span>
        {placement && !event.allDay && !segment.continuesAfter && (
          <span
            aria-hidden="true"
            data-handle="resize"
            className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize"
          />
        )}
        {segment.continuesBefore && <span className="sr-only">{t('continuesBefore')}</span>}
        {segment.continuesAfter && <span className="sr-only">{t('continuesAfter')}</span>}
      </button>
    );
  },
  // `placement` is rebuilt whenever its column re-lays out; compare it by value.
  (a, b) =>
    a.segment === b.segment &&
    a.roomName === b.roomName &&
    a.showRoom === b.showRoom &&
    a.placement?.col === b.placement?.col &&
    a.placement?.span === b.placement?.span &&
    a.placement?.cols === b.placement?.cols,
);
