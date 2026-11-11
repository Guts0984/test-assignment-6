'use client';

import { useQueries } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { RoomDto } from '@/shared/contracts';
import { keys, fetchPeriod, useRuntime, type Period } from '@/features/events';
import { addDays, formatCivil, type Civil } from '@/shared/zoned';
import { agenda } from '../domain/month';
import { LIST_WINDOW_DAYS, rangeOf, type Range } from '../domain/range';
import { useEnv } from '../context';
import { longDate, roomHue, timeRange } from '../format';
import { useUi } from '../state/ui-store';

/**
 * The list view: day after day with an event, endlessly. Windows of two weeks are loaded as you
 * scroll; an IntersectionObserver on a sentinel at the bottom asks for the next one.
 */
export function ListView({
  range,
  initial,
  rooms,
  roomFilter,
  label,
}: {
  range: Range;
  initial?: Period;
  rooms: ReadonlyMap<string, RoomDto>;
  /** Room ids from the URL's `rooms=` filter; empty means every room (as in the other views). */
  roomFilter: readonly string[];
  label: string;
}) {
  const runtime = useRuntime();
  const { tz, locale, clock, names, weekStart } = useEnv();
  const t = useTranslations('calendar');
  const select = useUi((s) => s.select);
  const [windows, setWindows] = useState(1);
  const sentinel = useRef<HTMLDivElement>(null);

  const ranges = useMemo(
    () =>
      Array.from({ length: windows }, (_, i) =>
        rangeOf('list', addDays(range.anchor, i * LIST_WINDOW_DAYS), weekStart, tz),
      ),
    [windows, range.anchor, weekStart, tz],
  );
  const queries = useQueries({
    queries: ranges.map((r, i) => ({
      queryKey: keys.period(r.from, r.to),
      // Changes not yet sent are drawn over what the server says, here as everywhere else.
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        const period = await fetchPeriod(r.from, r.to, signal);
        return runtime ? runtime.overlay(period) : period;
      },
      initialData:
        i === 0 && initial && initial.from === r.from && initial.to === r.to ? initial : undefined,
      staleTime: 30_000,
    })),
  });
  const loaded = queries.every((q) => q.data);
  const events = useMemo(() => {
    const all = queries.flatMap((q) => q.data?.events ?? []);
    if (roomFilter.length === 0) return all;
    const wanted = new Set(roomFilter);
    return all.filter((e) => wanted.has(e.roomId));
  }, [queries, roomFilter]);
  const last = ranges[ranges.length - 1]!.days.at(-1) as Civil;
  const days = useMemo(
    () => agenda(events, tz, range.anchor, last),
    [events, tz, range.anchor, last],
  );

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !loaded) return;
    const io = new IntersectionObserver(
      (entries) => entries.some((e) => e.isIntersecting) && setWindows((w) => w + 1),
      { rootMargin: '400px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [loaded, windows]);

  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      data-testid="list-view"
      className="border-border bg-surface h-full overflow-auto rounded-lg border p-3"
    >
      {days.length === 0 && loaded && (
        <p className="text-muted-foreground p-4 text-sm">{t('noEvents')}</p>
      )}
      {days.map(({ date, segments }) => (
        <section
          key={formatCivil(date)}
          aria-label={longDate(date, locale, names)}
          data-date={formatCivil(date)}
          className="mb-4"
        >
          <h2 className="bg-surface sticky top-0 z-10 py-1 text-sm font-semibold">
            {longDate(date, locale, names)}{' '}
            <span className="text-muted-foreground font-normal">
              · {t('eventsCount', { count: segments.length })}
            </span>
          </h2>
          <ul className="flex flex-col gap-1">
            {segments.map((s) => (
              <li key={`${s.event.key}:${formatCivil(date)}`}>
                <button
                  type="button"
                  className="event-block !static flex w-full items-baseline gap-3 !px-2 !py-1.5"
                  data-key={s.event.key}
                  data-sync={s.event.sync}
                  style={{ ['--hue' as string]: roomHue(s.event.roomId) }}
                  onClick={() => select(s.event.key)}
                >
                  <span className="w-28 shrink-0 tabular-nums">
                    {s.allDay
                      ? t('allDay')
                      : timeRange(s.event.start, s.event.end, tz, clock, names.time)}
                  </span>
                  <span className="font-semibold">{s.event.title}</span>
                  <span className="ml-auto text-xs opacity-80">
                    {rooms.get(s.event.roomId)?.name} · {s.event.creatorName}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <div ref={sentinel} aria-hidden="true" className="h-8" />
      {!loaded && <p className="text-muted-foreground p-2 text-sm">{t('loading')}</p>}
    </div>
  );
}
