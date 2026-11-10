'use client';

import { memo, useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import type { RoomDto } from '@/shared/contracts';
import { formatHour, fromLocal, sameCivil, toLocal, startOfDay, type Civil } from '@/shared/zoned';
import { layoutColumn } from '../domain/layout';
import type { Segment } from '../domain/segments';
import { useEnv } from '../context';
import { dayHeading } from '../format';
import { EventBlock, MIN_BLOCK_MINUTES, PX_PER_HOUR } from './EventBlock';
import { NowLine, useNow } from './NowLine';
import { useUi } from '../state/ui-store';
import { formatClock } from '@/shared/zoned';
import { useGridKeyboard } from './useGridKeyboard';
import { useGridPointer, type GridPointerHandlers } from './useGridPointer';
import { longDate } from '../format';
import { dayOf } from '../domain/segments';

export type GridColumn = {
  id: string;
  date: Civil;
  /** Day view: this column is one room. Week view: undefined (all rooms share the day). */
  roomId?: string;
  title: string;
  subtitle?: string;
  timed: Segment[];
  allDay: Segment[];
};

const AXIS_PX = 56;
const COLUMN_MIN_PX = 132;
const HEADER_PX = 48;

type ColumnProps = {
  column: GridColumn;
  index: number;
  rooms: ReadonlyMap<string, RoomDto>;
  showRoom: boolean;
};

const sameList = <T,>(a: readonly T[], b: readonly T[]): boolean =>
  a === b || (a.length === b.length && a.every((x, i) => x === b[i]));

/**
 * One day/room column: lays out its events side by side. Re-renders only if ITS segments change.
 * The column object is rebuilt on every edit, so "changed" means: its segments are not the same ones.
 */
const ColumnBody = memo(
  function ColumnBody({ column, index, rooms, showRoom }: ColumnProps) {
    const placements = useMemo(
      () =>
        new Map(
          layoutColumn(
            column.timed.map((s) => ({ id: s.event.key, startMin: s.startMin, endMin: s.endMin })),
            // A short event is drawn taller than it is long: lay it out by what is drawn.
            MIN_BLOCK_MINUTES,
          ).map((p) => [p.id, p]),
        ),
      [column.timed],
    );
    return (
      <>
        {column.timed.map((segment) => (
          <EventBlock
            key={segment.event.recurring ? segment.event.key : segment.event.eventId}
            segment={segment}
            placement={placements.get(segment.event.key)}
            roomName={rooms.get(segment.event.roomId)?.name ?? ''}
            showRoom={showRoom}
          />
        ))}
        <DragGhost columnId={column.id} />
        <CursorSlot index={index} />
        <NowLine date={column.date} />
      </>
    );
  },
  (a, b) =>
    a.index === b.index &&
    a.rooms === b.rooms &&
    a.showRoom === b.showRoom &&
    a.column.id === b.column.id &&
    sameCivil(a.column.date, b.column.date) &&
    sameList(a.column.timed, b.column.timed),
);

/** Column heading. In the week view the day number is big and today is highlighted (after hydration). */
function ColumnHeader({ column }: { column: GridColumn }) {
  const { tz, names } = useEnv();
  const now = useNow();
  const isDay = column.roomId === undefined;
  const heading = dayHeading(column.date, names);
  const today = isDay && now !== null && sameCivil(dayOf(now, tz), column.date);
  return (
    <div
      className="border-border bg-surface sticky top-0 z-20 flex flex-col items-center justify-center border-b border-l px-1 text-center"
      style={{ height: HEADER_PX }}
      data-today={today ? 'true' : undefined}
    >
      <span className="text-xs font-semibold">{isDay ? heading.weekday : column.title}</span>
      <span
        className={`text-[11px] ${today ? 'bg-primary text-primary-foreground rounded-full px-2 text-sm font-bold' : isDay ? 'text-base font-semibold' : 'text-muted-foreground'}`}
      >
        {isDay ? heading.day : column.subtitle}
      </span>
    </div>
  );
}

/** The keyboard cursor: the slot the arrow keys are on. Drawn only in its own column. */
function CursorSlot({ index }: { index: number }) {
  const cursor = useUi((s) => (s.cursor?.columnIndex === index ? s.cursor : null));
  if (!cursor) return null;
  return (
    <div
      aria-hidden="true"
      data-testid="grid-cursor"
      className="border-primary bg-primary/10 pointer-events-none absolute inset-x-0 z-20 rounded border-2"
      style={{ top: (cursor.minutes * PX_PER_HOUR) / 60, height: PX_PER_HOUR / 4 }}
    />
  );
}

/** The preview of a drag, drawn only in the column the pointer is over. */
function DragGhost({ columnId }: { columnId: string }) {
  const drag = useUi((s) => (s.drag?.columnId === columnId ? s.drag : null));
  const { clock, names } = useEnv();
  if (!drag) return null;
  const label = `${formatClock(drag.startMin, clock, names.time)} – ${formatClock(drag.endMin, clock, names.time)}`;
  return (
    <div
      aria-hidden="true"
      data-testid="drag-ghost"
      className="border-primary bg-primary/15 text-primary pointer-events-none absolute inset-x-1 z-20 rounded-md border-2 border-dashed px-1 text-[11px] font-semibold"
      style={{
        top: (drag.startMin * PX_PER_HOUR) / 60,
        height: ((drag.endMin - drag.startMin) * PX_PER_HOUR) / 60,
      }}
    >
      {label}
    </div>
  );
}

const AllDayCell = memo(
  function AllDayCell({
    segments,
    rooms,
  }: {
    segments: Segment[];
    rooms: ReadonlyMap<string, RoomDto>;
  }) {
    return (
      <div className="border-border min-h-7 border-b border-l p-0.5">
        {segments.map((s) => (
          <EventBlock
            key={`${s.event.key}:${s.date.d}`}
            segment={s}
            roomName={rooms.get(s.event.roomId)?.name ?? ''}
            showRoom
          />
        ))}
      </div>
    );
  },
  (a, b) => a.rooms === b.rooms && sameList(a.segments, b.segments),
);

function HourLabels({
  tz,
  date,
  secondary,
}: {
  tz: string;
  date: Civil;
  secondary: string | null;
}) {
  const { clock, names } = useEnv();
  const t = useTranslations('calendar');
  const hours = Array.from({ length: 24 }, (_, h) => h);
  const labelOf = (h: number): string => {
    if (!secondary) return formatHour(h, clock, names.time);
    // The same instant seen in the second zone; mark when it falls on another day there.
    const instant = fromLocal({ ...date, h, mi: 0, s: 0 }, tz);
    const other = toLocal(instant, secondary);
    const shift = Math.sign(
      startOfDay({ y: other.y, m: other.m, d: other.d }, secondary) - startOfDay(date, secondary),
    );
    return `${formatHour(other.h, clock, names.time)}${shift === 0 ? '' : shift > 0 ? ' +1' : ' −1'}`;
  };
  return (
    <div aria-hidden="true" className="relative" style={{ height: 24 * PX_PER_HOUR }}>
      {hours.map((h) => (
        <span
          key={h}
          className="text-muted-foreground absolute right-1 -translate-y-1/2 text-[11px]"
          style={{ top: h * PX_PER_HOUR }}
        >
          {h === 0 ? '' : labelOf(h)}
        </span>
      ))}
      <span className="sr-only">{secondary ? t('secondZone') : t('timeColumn')}</span>
    </div>
  );
}

type Props = Partial<GridPointerHandlers> & {
  onOpen?: (key: string) => void;
  onChange?: (segment: Segment, column: GridColumn, startMin: number, endMin: number) => void;
  columns: readonly GridColumn[];
  rooms: ReadonlyMap<string, RoomDto>;
  showRoom: boolean;
  label: string;
  children?: ReactNode;
};

/**
 * The time grid shared by the day view (one column per room) and the week view (one column per day).
 * Time runs down, pinned on the left; the header and the all-day row stay on top while scrolling.
 */
export function TimeGrid({
  columns,
  rooms,
  showRoom,
  label,
  onCreate,
  onMove,
  onResize,
  onActivate,
  onOpen,
  onChange,
}: Props) {
  const { tz, tz2 } = useEnv();
  const t = useTranslations('calendar');
  const first = columns[0]?.date;
  const scroller = useRef<HTMLDivElement>(null);
  // Open near working hours instead of at midnight (once, when the view appears).
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 7 * PX_PER_HOUR;
  }, [columns.length]);
  const onPointerDown = useGridPointer({
    containerRef: scroller,
    columns,
    onCreate: onCreate ?? (() => {}),
    onMove: onMove ?? (() => {}),
    onResize: onResize ?? (() => {}),
    onActivate: onActivate ?? (() => {}),
  });
  const { locale, clock, names } = useEnv();
  const ta = useTranslations('announce');
  const describe = useCallback(
    (columnIndex: number, minutes: number) => {
      const c = columns[columnIndex];
      return {
        day: c ? longDate(c.date, locale, names) : '',
        time: formatClock(minutes, clock, names.time),
        room: c?.roomId ? c.title : undefined,
      };
    },
    [columns, locale, clock, names],
  );
  const say = useCallback(
    (code: string, params: Record<string, string>) =>
      useUi
        .getState()
        .announce(
          (ta as unknown as (k: string, v: Record<string, string>) => string)(code, params),
        ),
    [ta],
  );
  const onKeyDown = useGridKeyboard({
    containerRef: scroller,
    columns,
    describe,
    say,
    onChange: onChange ?? (() => {}),
    onOpenEvent: onOpen ?? (() => {}),
    onCreateAt: onCreate ?? (() => {}),
  });
  // A different set of columns (another view or date) invalidates the cursor.
  useEffect(() => useUi.getState().setCursor(null), [columns.length]);
  const axisCount = tz2 ? 2 : 1;
  const template = `repeat(${axisCount}, ${AXIS_PX}px) repeat(${columns.length}, minmax(${COLUMN_MIN_PX}px, 1fr))`;
  const hasAllDay = columns.some((c) => c.allDay.length > 0);

  return (
    <div
      ref={scroller}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          useUi.getState().setCursor(null);
          if (useUi.getState().drag?.kbd) useUi.getState().setDrag(null);
        }
      }}
      onDoubleClick={(e) => {
        const key = (e.target as HTMLElement).closest<HTMLElement>('.event-block[data-key]')
          ?.dataset.key;
        if (key) onOpen?.(key);
      }}
      role="region"
      aria-label={label}
      tabIndex={0}
      data-testid="time-grid"
      className="border-border bg-surface relative h-full overflow-auto rounded-lg border"
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: template,
          minWidth: AXIS_PX * axisCount + COLUMN_MIN_PX * columns.length,
        }}
      >
        {/* header row */}
        {Array.from({ length: axisCount }, (_, i) => (
          <div
            key={`h${i}`}
            className="border-border bg-surface sticky top-0 left-0 z-30 border-b"
            style={{ height: HEADER_PX, left: i * AXIS_PX }}
          />
        ))}
        {columns.map((c) => (
          <ColumnHeader key={`h-${c.id}`} column={c} />
        ))}

        {/* all-day row */}
        {hasAllDay && (
          <>
            {Array.from({ length: axisCount }, (_, i) => (
              <div
                key={`a${i}`}
                className="border-border bg-surface text-muted-foreground sticky z-20 border-b px-1 text-right text-[10px] leading-7"
                style={{ top: HEADER_PX, left: i * AXIS_PX }}
              >
                {i === 0 ? t('allDay') : ''}
              </div>
            ))}
            {columns.map((c) => (
              <div key={`ad-${c.id}`} className="bg-surface sticky z-10" style={{ top: HEADER_PX }}>
                <AllDayCell segments={c.allDay} rooms={rooms} />
              </div>
            ))}
          </>
        )}

        {/* time axes + columns */}
        <div data-testid="time-axis" className="bg-surface sticky left-0 z-10" style={{ left: 0 }}>
          {first && <HourLabels tz={tz} date={first} secondary={null} />}
        </div>
        {tz2 && (
          <div className="bg-surface sticky z-10" style={{ left: AXIS_PX }}>
            {first && <HourLabels tz={tz} date={first} secondary={tz2} />}
          </div>
        )}
        {columns.map((c, i) => (
          <div
            key={c.id}
            data-column-id={c.id}
            data-date={`${c.date.y}-${c.date.m}-${c.date.d}`}
            className="grid-hours border-border relative border-l"
            style={{ height: 24 * PX_PER_HOUR, ['--hour' as string]: `${PX_PER_HOUR}px` }}
          >
            <ColumnBody column={c} index={i} rooms={rooms} showRoom={showRoom} />
          </div>
        ))}
      </div>
    </div>
  );
}
