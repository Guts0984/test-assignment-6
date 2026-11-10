'use client';

import { useEffect, useMemo, useState } from 'react';
import type { RoomDto } from '@/shared/contracts';
import { debounce, createLatestOnly } from './latest-only';

export type FreeRooms =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; free: RoomDto[]; busyIds: ReadonlySet<string> }
  | { status: 'error' };

type Settled = { key: string; busy: Set<string> } | { key: string; error: true };

/**
 * Suggests the rooms that are free for the time being typed. Typing is debounced, a newer lookup cancels
 * the older one, and an old answer that arrives late is thrown away (see createLatestOnly). "Loading" is
 * derived: it means the last settled answer is for a different slot than the one now typed.
 */
export function useFreeRooms(
  slot: { start: number; end: number } | null,
  rooms: readonly RoomDto[],
  fetchBusy: (from: number, to: number, signal: AbortSignal) => Promise<Set<string>>,
  debounceMs = 250,
): FreeRooms {
  const [settled, setSettled] = useState<Settled | null>(null);
  const lookup = useMemo(() => createLatestOnly<Set<string>>(), []);
  const start = slot?.start;
  const end = slot?.end;
  const key = start === undefined || end === undefined ? null : `${start}-${end}`;

  useEffect(() => {
    if (key === null || start === undefined || end === undefined) {
      lookup.cancel();
      return;
    }
    const run = debounce(() => {
      lookup
        .run((signal) => fetchBusy(start, end, signal))
        .then((r) => !r.stale && setSettled({ key, busy: r.value }))
        .catch(() => setSettled({ key, error: true }));
    }, debounceMs);
    run();
    return () => {
      run.cancel();
      lookup.cancel();
    };
  }, [key, start, end, fetchBusy, lookup, debounceMs]);

  if (key === null) return { status: 'idle' };
  if (!settled || settled.key !== key) return { status: 'loading' };
  if ('error' in settled) return { status: 'error' };
  return {
    status: 'ready',
    free: rooms.filter((r) => !settled.busy.has(r.id)),
    busyIds: settled.busy,
  };
}
