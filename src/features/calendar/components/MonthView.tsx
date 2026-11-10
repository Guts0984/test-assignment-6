'use client';

import { memo, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import type { CalEvent } from '@/shared/calendar';
import type { RoomDto } from '@/shared/contracts';
import { formatCivil, type Civil } from '@/shared/zoned';
import { monthCells, type MonthCell } from '../domain/month';
import type { Range } from '../domain/range';
import { useEnv } from '../context';
import { dayHeading, roomHue, timeOf } from '../format';
import { useUi } from '../state/ui-store';

const CELL_CAPACITY = 4;

const MonthDay = memo(function MonthDay({
  cell,
  rooms,
  onOpenDay,
}: {
  cell: MonthCell;
  rooms: ReadonlyMap<string, RoomDto>;
  onOpenDay: (d: Civil) => void;
}) {
  const { tz, clock, names } = useEnv();
  const t = useTranslations('calendar');
  const select = useUi((s) => s.select);
  const iso = formatCivil(cell.date);
  return (
    <div
      role="gridcell"
      data-date={iso}
      className={`border-border flex min-h-28 flex-col gap-0.5 border-b border-l p-1 ${cell.inMonth ? '' : 'bg-muted/50 text-muted-foreground'}`}
    >
      <button
        type="button"
        className="hover:bg-muted inline-flex min-h-6 min-w-6 items-center justify-center self-start rounded px-1 text-xs font-semibold"
        onClick={() => onOpenDay(cell.date)}
      >
        {cell.date.d}
        <span className="sr-only"> · {t('eventsCount', { count: cell.items.length })}</span>
      </button>
      {cell.visible.map((s) => (
        <button
          type="button"
          key={`${s.event.key}:${iso}`}
          className="event-block"
          data-allday="true"
          data-key={s.event.key}
          data-sync={s.event.sync}
          style={{ ['--hue' as string]: roomHue(s.event.roomId) }}
          onClick={() => select(s.event.key)}
        >
          <span className="block truncate font-semibold">
            {!s.allDay && !s.continuesBefore
              ? `${timeOf(s.event.start, tz, clock, names.time)} `
              : ''}
            {s.event.title}
          </span>
          <span className="sr-only">
            {s.allDay ? `, ${t('allDay')}` : ''}, {rooms.get(s.event.roomId)?.name ?? ''}
          </span>
        </button>
      ))}
      {cell.more > 0 && (
        <button
          type="button"
          data-testid="more"
          className="text-primary inline-flex min-h-6 items-center self-start rounded px-1 text-xs font-medium hover:underline"
          onClick={() => onOpenDay(cell.date)}
        >
          {t('more', { count: cell.more })}
        </button>
      )}
    </div>
  );
});

export function MonthView({
  range,
  events,
  rooms,
  onOpenDay,
  label,
}: {
  range: Range;
  events: readonly CalEvent[];
  rooms: ReadonlyMap<string, RoomDto>;
  onOpenDay: (d: Civil) => void;
  label: string;
}) {
  const { tz, names } = useEnv();
  const anchor = range.anchor;
  const cells = useMemo(
    () => monthCells(range.days, { y: anchor.y, m: anchor.m }, events, tz, CELL_CAPACITY),
    [range.days, anchor.y, anchor.m, events, tz],
  );
  return (
    <div
      role="grid"
      aria-label={label}
      className="border-border bg-surface overflow-auto rounded-lg border"
      data-testid="month-grid"
    >
      <div role="row" className="grid grid-cols-7">
        {cells.slice(0, 7).map((c) => (
          <div
            role="columnheader"
            key={formatCivil(c.date)}
            className="border-border border-l p-1 text-center text-xs font-semibold first:border-l-0"
          >
            {dayHeading(c.date, names).weekday}
          </div>
        ))}
      </div>
      {Array.from({ length: cells.length / 7 }, (_, row) => (
        <div role="row" key={row} className="grid grid-cols-7">
          {cells.slice(row * 7, row * 7 + 7).map((c) => (
            <MonthDay key={formatCivil(c.date)} cell={c} rooms={rooms} onOpenDay={onOpenDay} />
          ))}
        </div>
      ))}
    </div>
  );
}
