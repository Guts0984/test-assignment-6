'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type LazyExoticComponent,
} from 'react';
import { useTranslations } from 'next-intl';
import {
  EventsProvider,
  useHistoryState,
  useOccurrences,
  usePrefetch,
  useRooms,
  useRuntime,
  useSyncState,
  fetchEvent,
  fetchPeriod,
  snapshotOf,
  useUsers,
  type EventChange,
  type Initial,
  type Notifier,
} from '@/features/events';
import { loadEventPanel, buildBody, type FormValues } from '@/features/event-form';
import { loadConflictDialog, SyncIndicator } from '@/features/sync';
import type { PublicUser } from '@/shared/contracts';
import type { ClockStyle } from '@/shared/i18n/config';
import type { CalEvent } from '@/shared/calendar';
import type { Scope } from '@/shared/contracts';
import { formatCivil, formatInstant, parseInstant, sameCivil, type Civil } from '@/shared/zoned';
import { daysOf, neighborRanges, rangeOf, shiftAnchor, weekStartOf } from '../domain/range';
import { changedBySegment, movedBySegment, resizedTimes, shiftSeriesTimes } from '../domain/move';
import type { Segment } from '../domain/segments';
import { dayKey, dayOf, segmentsOfCached } from '../domain/segments';
import { EnvProvider, type CalendarEnv } from '../context';
import { rangeTitle, timeOf, type Names } from '../format';
import { useLocation } from '../state/useLocation';
import type { CalendarLocation } from '../state/url';
import { useUi } from '../state/ui-store';
import { byDay, groupSegments } from './grouping';
import { ListView } from './ListView';
import { MonthView } from './MonthView';
import { TimeGrid, type GridColumn } from './TimeGrid';
import { Toolbar } from './Toolbar';
import { LiveRegion, Toasts } from './Toasts';
import type { Prefs } from './SettingsDialog';

/**
 * A dialog whose code is downloaded when first needed. If that download fails (offline, and the service
 * worker did not have the file), the dialog is dropped with a message: an unhandled failure of a lazy
 * component would take the whole page down.
 */
function lazyDialog<P extends object>(
  load: () => Promise<{ default: ComponentType<P> }>,
): LazyExoticComponent<ComponentType<P>> {
  return lazy(() =>
    load().catch(() => ({
      default: function ChunkUnavailable() {
        useEffect(() => {
          const ui = useUi.getState();
          ui.scopePrompt?.resolve(null); // a pending "which occurrences?" question must not hang
          ui.setSettingsOpen(false);
          ui.openPanel(null);
          ui.pushToast({ kind: 'error', code: 'CHUNK_UNAVAILABLE', params: {} });
        }, []);
        return null;
      } as ComponentType<P>,
    })),
  );
}

const ScopeDialog = lazyDialog(() => import('./ScopeDialog'));
const EventPanel = lazyDialog(loadEventPanel);
const ConflictDialog = lazyDialog(loadConflictDialog);
const SettingsDialog = lazyDialog(() => import('./SettingsDialog'));

type Props = {
  user: PublicUser;
  theme: Prefs['theme'];
  locale: string;
  clock: ClockStyle;
  initial: Initial;
  initialLocation: CalendarLocation;
  names: Names;
  tz2: string | null;
};

function CalendarScreen({
  user,
  locale,
  clock: clockProp,
  initial,
  initialLocation,
  names,
  tz2: tz2Prop,
  theme,
}: Props) {
  const t = useTranslations();
  // Viewing preferences can be changed from the settings dialog; the calendar re-lays out at once.
  const [prefs, setPrefs] = useState<Prefs>({
    tz: user.timezone,
    tz2: tz2Prop,
    clock: clockProp,
    theme,
  });
  const { tz, tz2, clock } = prefs;
  const settingsOpen = useUi((s) => s.settingsOpen);
  const weekStart = weekStartOf(locale);
  const [location, navigate] = useLocation(initialLocation, tz);
  const range = useMemo(
    () => rangeOf(location.view, location.date, weekStart, tz),
    [location.view, location.date, weekStart, tz],
  );
  const env: CalendarEnv = useMemo(
    () => ({ tz, tz2, locale, clock, weekStart, names, userId: user.id }),
    [tz, tz2, locale, clock, weekStart, names, user.id],
  );

  const roomsQuery = useRooms(initial.rooms);
  const usersQuery = useUsers(initial.users);
  const periodQuery = useOccurrences(range, initial.period);
  const allRooms = roomsQuery.data;
  const roomsById = useMemo(() => new Map(allRooms.map((r) => [r.id, r])), [allRooms]);
  const visibleRooms = useMemo(
    () =>
      location.rooms.length > 0 ? allRooms.filter((r) => location.rooms.includes(r.id)) : allRooms,
    [allRooms, location.rooms],
  );

  const [prev, next] = useMemo(() => neighborRanges(range, weekStart, tz), [range, weekStart, tz]);
  usePrefetch(location.view === 'list' ? [] : [prev, next], periodQuery.isSuccess);

  const events = useMemo(() => {
    const visible = new Set(visibleRooms.map((r) => r.id));
    return (periodQuery.data?.events ?? []).filter((e) => visible.has(e.roomId));
  }, [periodQuery.data, visibleRooms]);

  const segments = useMemo(() => {
    const first = range.days[0] as Civil;
    const last = range.days[range.days.length - 1] as Civil;
    return events.flatMap((e) => segmentsOfCached(e, tz, first, last));
  }, [events, range.days, tz]);

  const columns: GridColumn[] = useMemo(() => {
    if (location.view === 'week') {
      const byDate = groupSegments(segments, byDay);
      return range.days.map((date) => {
        const g = byDate.get(dayKey(date));
        return {
          id: formatCivil(date),
          date,
          title: '',
          timed: g?.timed ?? [],
          allDay: g?.allDay ?? [],
        };
      });
    }
    const date = range.days[0] as Civil;
    const byRoom = groupSegments(segments, (s) => s.event.roomId);
    return visibleRooms.map((room) => {
      const g = byRoom.get(room.id);
      return {
        id: room.id,
        date,
        roomId: room.id,
        title: room.name,
        subtitle: `${room.capacity}`,
        timed: g?.timed ?? [],
        allDay: g?.allDay ?? [],
      };
    });
  }, [location.view, segments, range.days, visibleRooms]);

  const runtime = useRuntime();
  const sync = useSyncState();
  const { canUndo, canRedo } = useHistoryState();
  const go = (patch: Partial<CalendarLocation>) => navigate({ ...location, ...patch });
  const scopePrompt = useUi((s) => s.scopePrompt);

  /** Recurring events ask "only this / this and following / all"; others skip straight through. */
  const chooseScope = async (
    event: CalEvent,
    kind: 'edit' | 'delete',
    allowAll: boolean,
  ): Promise<Scope | undefined | null> =>
    event.recurring ? useUi.getState().askScope({ kind, title: event.title, allowAll }) : undefined;

  async function change(event: CalEvent, patch: EventChange, allowAll: boolean) {
    const scope = await chooseScope(event, 'edit', allowAll);
    if (scope === null) return; // cancelled
    const change = { ...patch };
    // Editing the whole series WITH new times: the server wants the series' first occurrence, shifted by
    // the same wall-clock delta. An edit that leaves the times alone (name, room, people) needs none of it.
    if (scope === 'all' && change.start !== undefined && change.end !== undefined) {
      const master = await fetchEvent(event.eventId);
      if (!master) {
        // Never drop an edit silently: without the series (offline) its times cannot be worked out.
        useUi.getState().pushToast({ kind: 'error', code: 'SERIES_OFFLINE', params: {} });
        return;
      }
      const from = {
        start: parseInstant(master.startAt) as number,
        end: parseInstant(master.endAt) as number,
      };
      const to = shiftSeriesTimes({
        master: from,
        oldOccurrenceStart: event.start,
        newOccurrenceStart: change.start,
        oldOccurrenceEnd: event.end,
        newOccurrenceEnd: change.end,
        tzid: event.tzid,
      });
      change.series = { from, to };
    }
    const hadFocus = document.activeElement?.closest?.('.event-block') != null;
    runtime?.actions.change(event, change, scope);
    // The block is redrawn (in another column, or under a new key) and keyboard focus would be lost:
    // put it back on the same meeting so the next keystroke still acts on it.
    if (hadFocus) refocus(event.eventId);
  }

  /** Focuses the (first) block of an event once the grid has been redrawn. */
  function refocus(eventId: string) {
    let tries = 0;
    const attempt = () => {
      const block = document.querySelector<HTMLElement>(
        `.event-block[data-event-id="${CSS.escape(eventId)}"]`,
      );
      if (block) block.focus({ preventScroll: true });
      else if (++tries < 10) requestAnimationFrame(attempt);
    };
    requestAnimationFrame(attempt);
  }

  const onMove = (segment: Segment, column: GridColumn, startMin: number) => {
    const event = segment.event;
    // `segment` is the piece that was dragged: for a meeting across midnight the whole event moves with it.
    const target = movedBySegment(event, segment, { date: column.date, minutes: startMin }, tz);
    const roomId = column.roomId ?? event.roomId;
    if (target.start === event.start && roomId === event.roomId) return;
    void change(
      event,
      { ...target, ...(roomId !== event.roomId ? { roomId } : {}) },
      sameCivil(dayOf(event.start, tz), column.date),
    );
  };
  const onResize = (segment: Segment, column: GridColumn, endMin: number) => {
    const event = segment.event;
    const target = resizedTimes(event, { date: segment.date, minutes: endMin }, tz);
    if (target.end === event.end) return;
    void change(event, target, true);
  };
  /** A keyboard drop: the final column and times in one go (move and/or resize). */
  const onChange = (segment: Segment, column: GridColumn, startMin: number, endMin: number) => {
    const event = segment.event;
    const target = changedBySegment(event, segment, { date: column.date, startMin, endMin }, tz);
    const roomId = column.roomId ?? event.roomId;
    if (target.start === event.start && target.end === event.end && roomId === event.roomId) return;
    void change(
      event,
      { ...target, ...(roomId !== event.roomId ? { roomId } : {}) },
      sameCivil(dayOf(event.start, tz), column.date),
    );
  };
  const onCreate = (column: GridColumn, startMin: number, endMin: number) =>
    useUi.getState().openPanel({
      kind: 'create',
      date: column.date,
      startMin,
      endMin,
      roomId: column.roomId ?? visibleRooms[0]?.id ?? null,
    });

  async function deleteEvent(event: CalEvent) {
    const scope = await chooseScope(event, 'delete', true);
    if (scope === null) return;
    runtime?.actions.remove(
      event,
      scope,
      !event.recurring ? snapshotOf(event, formatInstant) : undefined,
    );
    useUi.getState().select(null);
  }

  /** Saves the edit panel: sends only what changed, asking about the scope for a recurring event. */
  function onEdit(event: CalEvent, values: FormValues) {
    const built = buildBody(values, { tz, labels: names.time });
    if (!built.ok) return;
    const b = built.body;
    const patch: EventChange = {};
    if (b.title !== event.title) patch.title = b.title;
    if (b.roomId !== event.roomId) patch.roomId = b.roomId;
    if (b.description !== event.description) patch.description = b.description;
    if (b.allDay !== event.allDay) patch.allDay = b.allDay;
    const [start, end] = [parseInstant(b.startAt) as number, parseInstant(b.endAt) as number];
    if (start !== event.start || end !== event.end) Object.assign(patch, { start, end });
    const [a, c] = [[...(b.attendeeIds ?? [])].sort(), [...event.attendeeIds].sort()];
    if (a.join() !== c.join()) patch.attendeeIds = b.attendeeIds ?? [];
    if (Object.keys(patch).length === 0) return;
    void change(event, patch, sameCivil(dayOf(event.start, tz), dayOf(start, tz)));
  }

  const panel = useUi((s) => s.panel);
  /** Opens the edit panel for an occurrence, remembering what it looked like at that moment. */
  function openEdit(key: string) {
    const event = runtime?.findByKey(key);
    if (event) useUi.getState().openPanel({ kind: 'edit', key, event });
  }
  // The live occurrence if it is still there; otherwise (somebody moved it, or our own move was
  // confirmed under a new key) the one the panel was opened for. Either way the panel stays open: it
  // holds typing that has not been saved.
  const editEvent =
    panel?.kind === 'edit' ? (runtime?.findByKey(panel.key) ?? panel.event) : undefined;
  const fetchBusy = async (from: number, to: number, signal: AbortSignal, except?: string) => {
    const period = await fetchPeriod(from, to, signal);
    return new Set(
      period.events
        .filter((e) => e.eventId !== except && e.start < to && e.end > from)
        .map((e) => e.roomId),
    );
  };

  // Delete / Backspace removes the selected event (asking about the scope for a recurring one).
  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const target = e.target;
      if (
        target instanceof HTMLElement &&
        (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
          target.isContentEditable ||
          target.closest('dialog')) // the panel, settings, the scope question: never delete behind them
      )
        return;
      const ui = useUi.getState();
      if (ui.panel || ui.settingsOpen || ui.scopePrompt) return;
      const key = useUi.getState().selectedKey;
      const event = key ? runtime?.findByKey(key) : undefined;
      if (!event) return;
      e.preventDefault();
      await deleteEvent(event);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deleteEvent only uses the store and the runtime
  }, [runtime]);

  return (
    <EnvProvider value={env}>
      <div className="flex h-dvh flex-col">
        <Toolbar
          title={rangeTitle(
            location.view,
            daysOf(location.view, location.date, weekStart),
            locale,
            names,
          )}
          view={location.view}
          rooms={allRooms}
          selectedRooms={location.rooms}
          onView={(view) => go({ view })}
          onPrev={() => go({ date: shiftAnchor(location.view, location.date, -1) })}
          onNext={() => go({ date: shiftAnchor(location.view, location.date, 1) })}
          onToday={() => go({ date: dayOf(Date.now(), tz) })}
          onRooms={(rooms) => go({ rooms })}
          onUndo={() => runtime?.actions.undo()}
          onRedo={() => runtime?.actions.redo()}
          canUndo={canUndo}
          canRedo={canRedo}
          onSettings={() => useUi.getState().setSettingsOpen(true)}
          onNew={() =>
            useUi.getState().openPanel({
              kind: 'create',
              date: dayOf(Date.now(), tz),
              startMin: 9 * 60,
              endMin: 10 * 60,
              roomId: visibleRooms[0]?.id ?? null,
            })
          }
          trailing={<SyncIndicator state={sync} />}
        />
        <main className="min-h-0 flex-1 p-3" aria-busy={periodQuery.isFetching}>
          {(location.view === 'day' || location.view === 'week') && (
            <TimeGrid
              columns={columns}
              rooms={roomsById}
              showRoom={location.view === 'week'}
              label={t('calendar.gridLabel')}
              onCreate={onCreate}
              onMove={onMove}
              onResize={onResize}
              onActivate={(key) => useUi.getState().select(key)}
              onOpen={openEdit}
              onChange={onChange}
            />
          )}
          {location.view === 'month' && (
            <MonthView
              range={range}
              events={events}
              rooms={roomsById}
              label={t('calendar.gridLabel')}
              onOpenDay={(date) => go({ view: 'day', date })}
            />
          )}
          {location.view === 'list' && (
            <ListView
              key={formatCivil(location.date)}
              range={range}
              initial={initial.period}
              rooms={roomsById}
              roomFilter={location.rooms}
              label={t('calendar.gridLabel')}
            />
          )}
        </main>
        <Toasts />
        <LiveRegion />
        {panel && (panel.kind === 'create' || editEvent) && (
          <Suspense fallback={null}>
            <EventPanel
              key={panel.kind === 'edit' ? panel.key : 'new'}
              mode={
                panel.kind === 'create' ? panel : { kind: 'edit', event: editEvent as CalEvent }
              }
              tz={tz}
              clock={clock}
              labels={names.time}
              weekStart={weekStart}
              rooms={allRooms}
              users={usersQuery.data}
              onCreate={(input) =>
                runtime?.actions.create({ ...input, start: input.start, end: input.end })
              }
              onEdit={onEdit}
              onDelete={(event) => void deleteEvent(event)}
              fetchBusy={fetchBusy}
              onClose={() => useUi.getState().openPanel(null)}
            />
          </Suspense>
        )}
        {sync.status === 'conflict' && sync.conflict && (
          <Suspense fallback={null}>
            <ConflictDialog
              conflict={sync.conflict}
              onResolve={(choice) => void runtime?.engine.resolveConflict(choice)}
              format={{
                time: (iso) =>
                  timeOf(parseInstant(iso) as number, tz, clock, names.time) +
                  ' · ' +
                  formatCivil(dayOf(parseInstant(iso) as number, tz)),
                room: (id) => roomsById.get(id)?.name ?? id,
                people: (ids) =>
                  ids.map((id) => usersQuery.data.find((u) => u.id === id)?.name ?? id).join(', '),
              }}
            />
          </Suspense>
        )}
        {settingsOpen && (
          <Suspense fallback={null}>
            <SettingsDialog
              user={{ ...user, timezone: tz }}
              locale={locale}
              prefs={prefs}
              onApply={setPrefs}
              onClose={() => useUi.getState().setSettingsOpen(false)}
            />
          </Suspense>
        )}
        {scopePrompt && (
          <Suspense fallback={null}>
            <ScopeDialog />
          </Suspense>
        )}
      </div>
    </EnvProvider>
  );
}

export function CalendarApp(props: Omit<Props, 'names' | 'tz2'> & { tz2?: string | null }) {
  const t = useTranslations();
  const [client] = useState(
    () =>
      new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } } }),
  );
  const names: Names = useMemo(
    () => ({
      weekdayShort: t.raw('weekdays.short'),
      weekdayLong: t.raw('weekdays.long'),
      monthLong: t.raw('months.long'),
      monthShort: t.raw('months.short'),
      monthGenitive: t.raw('months.genitive'),
      time: t.raw('time'),
    }),
    [t],
  );
  const usersById = useMemo(
    () => new Map(props.initial.users.map((u) => [u.id, u.name])),
    [props.initial.users],
  );
  const notifier: Notifier = useMemo(
    () => ({
      notify: (n) =>
        useUi.getState().pushToast({ kind: n.kind, code: n.code, params: n.params ?? {} }),
      announce: (code, params) => useUi.getState().announce(t(`announce.${code}`, params)),
    }),
    [t],
  );
  return (
    <QueryClientProvider client={client}>
      <EventsProvider
        user={props.user}
        userName={(id) => usersById.get(id) ?? '?'}
        notifier={notifier}
      >
        <CalendarScreen {...props} names={names} tz2={props.tz2 ?? null} />
      </EventsProvider>
    </QueryClientProvider>
  );
}
