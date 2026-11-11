'use client';

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useForm, useWatch, type Resolver } from 'react-hook-form';
import { useTranslations } from 'next-intl';
import type { CalEvent } from '@/shared/calendar';
import type { DirectoryUser, RoomDto } from '@/shared/contracts';
import { focusInitial } from '@/shared/focus-initial';
import type { ClockStyle } from '@/shared/i18n/config';
import {
  formatCivil,
  formatClock,
  parseInstant,
  type Civil,
  type TimeLabels,
} from '@/shared/zoned';
import {
  buildBody,
  noRepeat,
  slotOf,
  valuesFor,
  type BuildContext,
  type Errors,
  type FormValues,
  startWeekday,
} from './form-model';
import { formSchema } from './schema';
import { useFreeRooms } from './useFreeRooms';

const RecurrenceEditor = lazy(() => import('./RecurrenceEditor'));

export type PanelMode =
  | { kind: 'create'; date: Civil; startMin: number; endMin: number; roomId: string | null }
  | { kind: 'edit'; event: CalEvent };

export type NewEventInput = {
  roomId: string;
  title: string;
  description: string;
  start: number;
  end: number;
  allDay: boolean;
  tzid: string;
  rrule: string | null;
  attendeeIds: string[];
};

type Props = {
  mode: PanelMode;
  tz: string;
  clock: ClockStyle;
  labels: TimeLabels;
  weekStart: number;
  rooms: readonly RoomDto[];
  users: readonly DirectoryUser[];
  onCreate: (input: NewEventInput) => void;
  onEdit: (event: CalEvent, values: FormValues) => void;
  onDelete: (event: CalEvent) => void;
  /** Rooms that have something at that time (excluding `exceptEventId`). */
  fetchBusy: (
    from: number,
    to: number,
    signal: AbortSignal,
    exceptEventId?: string,
  ) => Promise<Set<string>>;
  onClose: () => void;
};

const input = 'w-full rounded-md border border-border bg-surface px-3 py-2 text-sm';
const labelCls = 'flex flex-col gap-1 text-sm font-medium';
const errorCls = 'text-xs font-normal text-destructive';

/**
 * The create/edit side panel. A native <dialog>: modal focus trap, Escape, and focus returns to what
 * opened it. Closing with unsaved changes asks first, so a stray Escape or click never loses typing.
 */
export default function EventPanel(props: Props) {
  const { mode, tz, clock, labels, rooms, users, onClose } = props;
  const t = useTranslations('form');
  const te = useTranslations('form.errors');
  const ctx: BuildContext = useMemo(() => ({ tz, labels }), [tz, labels]);
  const editing = mode.kind === 'edit' ? mode.event : null;
  const formatTime = useCallback((m: number) => formatClock(m, clock, labels), [clock, labels]);

  const [defaults] = useState<FormValues>(() => {
    if (mode.kind === 'edit') {
      const e = mode.event;
      return valuesFor({ ...e, rrule: null }, tz, e.tzid, formatTime);
    }
    const day = formatCivil(mode.date);
    return {
      ...baseValues(),
      roomId: mode.roomId ?? '',
      startDate: day,
      endDate: day,
      startTime: formatTime(mode.startMin),
      endTime: formatTime(mode.endMin % 1440),
    };
  });

  const resolver: Resolver<FormValues> = useCallback(
    async (values) => {
      const shape = formSchema.safeParse(values);
      const errors: Errors = shape.success ? {} : { title: 'titleRequired' };
      const built = shape.success ? buildBody(values, ctx) : null;
      const found = built && !built.ok ? built.errors : errors;
      if (Object.keys(found).length === 0 && built?.ok) return { values, errors: {} };
      return {
        values: {},
        errors: Object.fromEntries(
          Object.entries(found).map(([k, code]) => [k, { type: 'validate', message: code }]),
        ),
      } as never;
    },
    [ctx],
  );

  const { register, handleSubmit, setValue, control, formState } = useForm<FormValues>({
    defaultValues: defaults,
    resolver,
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  });
  const values = useWatch({ control }) as FormValues;
  const dirty = formState.isDirty;

  // --- free rooms ---
  const slot = useMemo(() => slotOf(values, ctx), [values, ctx]);
  // A stable function: it reads the latest `props.fetchBusy` through a ref. Depending on `props` itself
  // made it a new function on every render, which restarted the debounced lookup each time.
  const fetchBusyRef = useRef(props.fetchBusy);
  useEffect(() => {
    fetchBusyRef.current = props.fetchBusy;
  });
  const fetchBusy = useCallback(
    (from: number, to: number, signal: AbortSignal) =>
      fetchBusyRef.current(from, to, signal, editing?.eventId),
    [editing?.eventId],
  );
  const free = useFreeRooms(slot, rooms, fetchBusy);
  const roomBusy =
    free.status === 'ready' && values.roomId !== '' && free.busyIds.has(values.roomId);

  // --- dialog behaviour ---
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    opener.current = document.activeElement;
    dialog.current?.showModal();
    focusInitial(dialog.current);
    return () => {
      const el = opener.current;
      // Back to what opened the panel; after a drag-create nothing was focused, so go to the grid.
      queueMicrotask(() =>
        (el instanceof HTMLElement && document.contains(el) && el !== document.body
          ? el
          : document.querySelector<HTMLElement>('[data-testid="time-grid"]')
        )?.focus(),
      );
    };
  }, []);
  const requestClose = () => (dirty ? setConfirming(true) : onClose());

  const submit = handleSubmit((v) => {
    if (editing) props.onEdit(editing, v);
    else {
      const b = buildBody(v, ctx);
      if (b.ok)
        props.onCreate({
          roomId: b.body.roomId,
          title: b.body.title,
          description: b.body.description ?? '',
          start: parseInstant(b.body.startAt) as number,
          end: parseInstant(b.body.endAt) as number,
          allDay: b.body.allDay ?? false,
          tzid: tz,
          rrule: b.body.rrule ?? null,
          attendeeIds: b.body.attendeeIds ?? [],
        });
    }
    onClose();
  });
  const err = (name: keyof Errors) =>
    formState.errors[name as keyof FormValues]?.message as string | undefined;
  const fieldError = (name: keyof Errors) =>
    err(name) ? (
      <span id={`err-${name}`} role="alert" className={errorCls}>
        {te(err(name) as never)}
      </span>
    ) : null;

  return (
    <dialog
      ref={dialog}
      data-testid="event-panel"
      aria-labelledby="panel-title"
      onCancel={(e) => {
        e.preventDefault();
        requestClose();
      }}
      onClick={(e) => e.target === dialog.current && requestClose()}
      className="border-border bg-surface text-foreground m-0 ml-auto h-dvh max-h-none w-[min(30rem,100vw)] max-w-none overflow-y-auto border-l p-0 backdrop:bg-black/40"
    >
      <form onSubmit={submit} noValidate className="flex min-h-full flex-col gap-4 p-5">
        <div className="flex items-center justify-between">
          <h2 id="panel-title" className="text-lg font-semibold">
            {editing ? t('editTitle') : t('createTitle')}
          </h2>
          <button
            type="button"
            className="hover:bg-muted rounded px-2 py-1"
            onClick={requestClose}
            aria-label={t('close')}
            data-testid="panel-close"
          >
            ×
          </button>
        </div>

        {confirming && (
          <div
            role="alertdialog"
            aria-labelledby="discard-title"
            data-testid="discard-confirm"
            className="border-destructive rounded-md border p-3 text-sm"
          >
            <p id="discard-title" className="font-semibold">
              {t('discardTitle')}
            </p>
            <p className="text-muted-foreground">{t('discardText')}</p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                autoFocus
                className="bg-primary text-primary-foreground rounded-md px-3 py-1.5"
                onClick={() => setConfirming(false)}
                data-testid="keep-editing"
              >
                {t('keepEditing')}
              </button>
              <button
                type="button"
                className="border-border rounded-md border px-3 py-1.5"
                onClick={onClose}
                data-testid="discard"
              >
                {t('discard')}
              </button>
            </div>
          </div>
        )}

        <label className={labelCls}>
          {t('title')}
          <input
            {...register('title')}
            autoFocus
            className={input}
            aria-invalid={!!err('title')}
            aria-describedby="err-title"
            data-testid="field-title"
            data-autofocus
          />
          {fieldError('title')}
        </label>

        <label className={labelCls}>
          {t('room')}
          <select
            {...register('roomId')}
            className={input}
            aria-invalid={!!err('roomId')}
            data-testid="field-room"
          >
            <option value="">{t('roomPlaceholder')}</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          {fieldError('roomId')}
        </label>

        <div aria-live="polite" data-testid="free-rooms" className="text-sm">
          {free.status === 'loading' && (
            <span className="text-muted-foreground">{t('checking')}</span>
          )}
          {free.status === 'ready' && (
            <>
              {roomBusy && (
                <p role="alert" className="text-destructive mb-1" data-testid="room-busy">
                  {t('roomBusy')}
                </p>
              )}
              <p className="text-muted-foreground mb-1">
                {free.free.length === 0 ? t('noFreeRooms') : t('freeRooms')}
              </p>
              <div className="flex flex-wrap gap-1">
                {free.free.slice(0, 8).map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    className={`rounded-full border px-2 py-0.5 text-xs ${values.roomId === r.id ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:bg-muted'}`}
                    onClick={() => setValue('roomId', r.id, { shouldDirty: true })}
                    aria-label={t('useRoom', { room: r.name })}
                    data-testid="free-room"
                  >
                    {r.name}
                  </button>
                ))}
                {free.free.length > 8 && (
                  <span className="text-muted-foreground px-1 text-xs">
                    {t('moreRooms', { count: free.free.length - 8 })}
                  </span>
                )}
              </div>
            </>
          )}
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" {...register('allDay')} data-testid="field-allday" /> {t('allDay')}
        </label>

        <fieldset className="grid grid-cols-2 gap-3">
          <legend className="sr-only">{t('start')}</legend>
          <label className={labelCls}>
            {t('start')} · {t('date')}
            <input
              type="date"
              {...register('startDate')}
              className={input}
              data-testid="field-start-date"
            />
            {fieldError('startDate')}
          </label>
          {!values.allDay && (
            <label className={labelCls}>
              {t('time')}
              <input
                {...register('startTime')}
                placeholder={t('timePlaceholder')}
                className={input}
                inputMode="text"
                aria-invalid={!!err('startTime')}
                data-testid="field-start-time"
              />
              {fieldError('startTime')}
            </label>
          )}
        </fieldset>
        <fieldset className="grid grid-cols-2 gap-3">
          <legend className="sr-only">{t('end')}</legend>
          <label className={labelCls}>
            {t('end')} · {t('date')}
            <input
              type="date"
              {...register('endDate')}
              className={input}
              data-testid="field-end-date"
            />
            {fieldError('endDate')}
          </label>
          {!values.allDay && (
            <label className={labelCls}>
              {t('time')}
              <input
                {...register('endTime')}
                placeholder={t('timePlaceholder')}
                className={input}
                aria-invalid={!!err('endTime')}
                data-testid="field-end-time"
              />
              {fieldError('endTime')}
            </label>
          )}
        </fieldset>

        {!editing && (
          <div className="flex flex-col gap-2">
            <label className={labelCls}>
              {t('repeat')}
              <select {...register('repeat.kind')} className={input} data-testid="field-repeat">
                <option value="none">{t('repeatNone')}</option>
                <option value="daily">{t('repeatDaily')}</option>
                <option value="weekly">{t('repeatWeekly')}</option>
                <option value="monthly">{t('repeatMonthly')}</option>
              </select>
            </label>
            {values.repeat.kind !== 'none' && (
              <Suspense
                fallback={<span className="text-muted-foreground text-sm">{t('checking')}</span>}
              >
                <RecurrenceEditor
                  control={control}
                  kind={values.repeat.kind}
                  weekStartFirst={props.weekStart}
                  startDay={startWeekday(values.startDate)}
                />
              </Suspense>
            )}
            {fieldError('repeat')}
          </div>
        )}
        {editing?.recurring && <p className="text-muted-foreground text-sm">↻ {t('repeat')}</p>}

        <fieldset className="text-sm">
          <legend className="mb-1 font-medium">{t('attendees')}</legend>
          <div className="flex max-h-32 flex-col gap-1 overflow-auto">
            {users.map((u) => (
              <label key={u.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  value={u.id}
                  {...register('attendeeIds')}
                  data-testid={`attendee-${u.id}`}
                />{' '}
                {u.name}
              </label>
            ))}
          </div>
        </fieldset>

        <label className={labelCls}>
          {t('description')}
          <textarea {...register('description')} rows={3} className={input} />
        </label>

        <div className="mt-auto flex gap-2 pt-2">
          <button
            type="submit"
            className="bg-primary text-primary-foreground rounded-md px-4 py-2 font-medium"
            data-testid="panel-save"
          >
            {editing ? t('save') : t('create')}
          </button>
          <button
            type="button"
            className="border-border rounded-md border px-4 py-2"
            onClick={requestClose}
          >
            {t('cancel')}
          </button>
          {editing && (
            <button
              type="button"
              className="border-destructive text-destructive ml-auto rounded-md border px-4 py-2"
              onClick={() => {
                props.onDelete(editing);
                onClose();
              }}
              data-testid="panel-delete"
            >
              {t('delete')}
            </button>
          )}
        </div>
      </form>
    </dialog>
  );
}

function baseValues(): FormValues {
  return {
    title: '',
    roomId: '',
    startDate: '',
    startTime: '',
    endDate: '',
    endTime: '',
    allDay: false,
    repeat: noRepeat,
    attendeeIds: [],
    description: '',
  };
}
