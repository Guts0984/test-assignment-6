'use client';

import { useTranslations } from 'next-intl';
import type { SyncState } from './types';

const DOT: Record<SyncState['status'], string> = {
  saved: 'bg-emerald-500',
  syncing: 'bg-amber-500 animate-pulse',
  offline: 'bg-zinc-500',
  conflict: 'bg-destructive',
  'signed-out': 'bg-destructive',
};

/** "Offline" / "Syncing, N changes" / "All saved", always visible, announced politely when it changes. */
export function SyncIndicator({ state }: { state: SyncState }) {
  const t = useTranslations('sync');
  const text =
    state.status === 'offline'
      ? state.pending > 0
        ? t('offlinePending', { count: state.pending })
        : t('offline')
      : state.status === 'syncing'
        ? t('syncing', { count: state.pending })
        : state.status === 'saved'
          ? t('saved')
          : t('error');
  return (
    <p
      role="status"
      data-testid="sync-indicator"
      data-status={state.status}
      data-pending={state.pending}
      className="text-muted-foreground flex items-center gap-2 text-sm"
    >
      <span
        aria-hidden="true"
        className={`inline-block h-2.5 w-2.5 rounded-full ${DOT[state.status]}`}
      />
      {text}
      {state.storageFailed && <span className="text-destructive">!</span>}
    </p>
  );
}
