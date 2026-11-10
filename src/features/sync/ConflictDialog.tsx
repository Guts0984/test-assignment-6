'use client';

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { focusInitial } from '@/shared/focus-initial';
import { diffRows, type DiffField, type DiffRow } from './conflict-diff';
import type { Conflict } from './types';

export type ConflictFormat = {
  /** An ISO instant in the viewer's zone and clock. */
  time: (iso: string) => string;
  room: (roomId: string) => string;
  people: (userIds: string[]) => string;
};

type Props = {
  conflict: Conflict;
  format: ConflictFormat;
  onResolve: (choice: 'mine' | 'server') => void;
};

/**
 * "My version or the server's": shown when an offline change meets somebody else's. The differences are
 * highlighted, and the dialog cannot be dismissed without choosing (Escape does nothing), because an
 * unresolved conflict blocks the rest of the queue. Loaded on demand, not part of the first load.
 */
export default function ConflictDialog({ conflict, format, onResolve }: Props) {
  const t = useTranslations('conflict');
  const ref = useRef<HTMLDialogElement>(null);
  const { command, current } = conflict;

  useEffect(() => {
    ref.current?.showModal();
    focusInitial(ref.current);
  }, []);

  const rows = current ? diffRows(command, current) : [];
  const show = (field: DiffField, value: DiffRow['mine']): string => {
    if (typeof value === 'boolean') return value ? t('yes') : t('no');
    if (Array.isArray(value)) return value.length === 0 ? t('empty') : format.people(value);
    if (value === '') return t('empty');
    if (field === 'start' || field === 'end') return format.time(value);
    if (field === 'roomId') return format.room(value);
    return value;
  };
  const title = current?.title ?? '';
  const cell = (differs: boolean) =>
    `px-3 py-2 align-top ${differs ? 'bg-destructive/15 font-semibold' : ''}`;

  return (
    <dialog
      ref={ref}
      data-testid="conflict-dialog"
      aria-labelledby="conflict-title"
      onCancel={(e) => e.preventDefault()}
      className="border-border bg-surface text-foreground m-auto w-[min(40rem,calc(100vw-2rem))] rounded-lg border p-5 backdrop:bg-black/50"
    >
      <h2 id="conflict-title" className="text-lg font-semibold">
        {t('title')}
      </h2>
      <p className="text-muted-foreground mt-1 text-sm">
        {!current
          ? t('gone')
          : command.kind === 'delete'
            ? t('deleteText', { title })
            : t('text', { title })}
      </p>
      {current && (
        <table className="mt-4 w-full border-collapse text-sm" data-testid="conflict-table">
          <thead>
            <tr className="border-border border-b text-left">
              <th scope="col" className="px-3 py-2 font-medium">
                <span className="sr-only">{t('title')}</span>
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                {command.kind === 'delete' ? t('deleting') : t('mine')}
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                {t('server')}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.field}
                className="border-border border-b"
                data-field={r.field}
                data-differs={r.differs ? 'true' : undefined}
              >
                <th scope="row" className="text-muted-foreground px-3 py-2 text-left font-medium">
                  {t(`fields.${r.field}`)}
                  {r.differs && <span className="sr-only"> ({t('differs')})</span>}
                </th>
                <td className={cell(r.differs)}>
                  {command.kind === 'delete' ? '' : show(r.field, r.mine)}
                </td>
                <td className={cell(r.differs)}>{show(r.field, r.server)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="mt-5 flex flex-wrap gap-2">
        <button
          type="button"
          autoFocus
          className="bg-primary text-primary-foreground rounded-md px-4 py-2 font-medium"
          onClick={() => onResolve('mine')}
          data-testid="conflict-mine"
        >
          {command.kind === 'delete' ? t('deleteMine') : t('keepMine')}
        </button>
        <button
          type="button"
          className="border-border rounded-md border px-4 py-2"
          onClick={() => onResolve('server')}
          data-testid="conflict-server"
        >
          {t('useServer')}
        </button>
      </div>
    </dialog>
  );
}
