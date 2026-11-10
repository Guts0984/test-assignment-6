'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import type { RoomDto } from '@/shared/contracts';
import { VIEWS, type View } from '../domain/range';

type Props = {
  title: string;
  view: View;
  rooms: readonly RoomDto[];
  selectedRooms: readonly string[];
  onView: (v: View) => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onRooms: (ids: string[]) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onNew: () => void;
  onSettings: () => void;
  trailing?: ReactNode;
};

const button = 'rounded-md border border-border bg-surface px-3 py-1.5 text-sm hover:bg-muted';

export function Toolbar({
  title,
  view,
  rooms,
  selectedRooms,
  onView,
  onPrev,
  onNext,
  onToday,
  onRooms,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onNew,
  onSettings,
  trailing,
}: Props) {
  const t = useTranslations('nav');
  const selected = new Set(selectedRooms);
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onRooms([...next]);
  };
  return (
    <header className="border-border bg-surface flex flex-wrap items-center gap-2 border-b px-3 py-2">
      <button type="button" className={button} onClick={onToday}>
        {t('today')}
      </button>
      <button type="button" className={button} onClick={onPrev} aria-label={t('previous')}>
        ‹
      </button>
      <button type="button" className={button} onClick={onNext} aria-label={t('next')}>
        ›
      </button>
      <h1
        className="mx-2 min-w-40 text-lg font-semibold"
        aria-live="polite"
        data-testid="range-title"
      >
        {title}
      </h1>
      <div
        role="group"
        aria-label={t('viewSwitcher')}
        className="border-border ml-auto flex overflow-hidden rounded-md border"
      >
        {VIEWS.map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={view === v}
            data-testid={`view-${v}`}
            onClick={() => onView(v)}
            className={`px-3 py-1.5 text-sm ${view === v ? 'bg-primary text-primary-foreground' : 'bg-surface hover:bg-muted'}`}
          >
            {t(`views.${v}`)}
          </button>
        ))}
      </div>
      <details className="relative">
        <summary className={`${button} cursor-pointer list-none`}>
          {selectedRooms.length === 0
            ? t('allRooms')
            : t('roomsSelected', { count: selectedRooms.length })}
        </summary>
        <div className="border-border bg-surface absolute right-0 z-40 mt-1 max-h-80 w-64 overflow-auto rounded-md border p-2 shadow-lg">
          <button
            type="button"
            className="hover:bg-muted mb-1 w-full rounded px-2 py-1 text-left text-sm"
            onClick={() => onRooms([])}
          >
            {t('allRooms')}
          </button>
          {rooms.map((r) => (
            <label
              key={r.id}
              className="hover:bg-muted flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm"
            >
              <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
              {r.name}
            </label>
          ))}
        </div>
      </details>
      <button
        type="button"
        className={button}
        onClick={onUndo}
        disabled={!canUndo}
        aria-label={t('undo')}
        title={t('undo')}
        data-testid="undo"
      >
        ↶
      </button>
      <button
        type="button"
        className={button}
        onClick={onRedo}
        disabled={!canRedo}
        aria-label={t('redo')}
        title={t('redo')}
        data-testid="redo"
      >
        ↷
      </button>
      <button
        type="button"
        className="bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-sm font-medium"
        onClick={onNew}
        data-testid="new-event"
      >
        {t('newEvent')}
      </button>
      {trailing}
      <button
        type="button"
        className={button}
        onClick={onSettings}
        aria-label={t('settings')}
        title={t('settings')}
        data-testid="open-settings"
      >
        ⚙
      </button>
    </header>
  );
}
