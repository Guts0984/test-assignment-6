'use client';

import {
  keepPreviousData,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { useEffect } from 'react';
import { api } from '@/shared/api/client';
import type { DirectoryUser, EventDto, OccurrenceDto, RoomDto } from '@/shared/contracts';
import { formatInstant } from '@/shared/zoned';
import type { Period } from './cache';
import { toPeriod } from './period';
import { useRuntime } from './Provider';

export const keys = {
  /** One cached query per visible period: changing one event patches these, it never reloads them all. */
  period: (from: number, to: number) => ['occurrences', from, to] as const,
  periods: ['occurrences'] as const,
  rooms: ['rooms'] as const,
  users: ['users'] as const,
};

export async function fetchPeriod(from: number, to: number, signal?: AbortSignal): Promise<Period> {
  const result = await api.get<{ occurrences: OccurrenceDto[] }>(
    `/api/events?from=${encodeURIComponent(formatInstant(from))}&to=${encodeURIComponent(formatInstant(to))}`,
    signal,
  );
  if (!result.ok) throw new Error(`events request failed: ${result.code}`);
  return toPeriod(from, to, result.data.occurrences);
}

export type Initial = { period?: Period; rooms: RoomDto[]; users: DirectoryUser[] };

export function useOccurrences(range: { from: number; to: number }, initial?: Period) {
  const runtime = useRuntime();
  return useQuery({
    queryKey: keys.period(range.from, range.to),
    // Unsent changes are drawn over the server's answer, so a refetch never makes them disappear.
    queryFn: async ({ signal }) => {
      const period = await fetchPeriod(range.from, range.to, signal);
      return runtime ? runtime.overlay(period) : period;
    },
    initialData:
      initial && initial.from === range.from && initial.to === range.to ? initial : undefined,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}

export function useRooms(initial: RoomDto[]) {
  return useQuery({
    queryKey: keys.rooms,
    queryFn: async () => {
      const r = await api.get<{ rooms: RoomDto[] }>('/api/rooms');
      if (!r.ok) throw new Error('rooms request failed');
      return r.data.rooms;
    },
    initialData: initial,
    staleTime: Infinity,
  });
}

export function useUsers(initial: DirectoryUser[]) {
  return useQuery({
    queryKey: keys.users,
    queryFn: async () => {
      const r = await api.get<{ users: DirectoryUser[] }>('/api/users');
      if (!r.ok) throw new Error('users request failed');
      return r.data.users;
    },
    initialData: initial,
    staleTime: Infinity,
  });
}

/** Quietly loads the periods before and after the visible one, so paging is instant. */
export const prefetchPeriods = (
  client: QueryClient,
  ranges: { from: number; to: number }[],
  /** Draws changes that are not sent yet over what was fetched (see runtime.overlay). */
  overlay: (period: Period) => Period = (p) => p,
): void => {
  for (const r of ranges) {
    void client.prefetchQuery({
      queryKey: keys.period(r.from, r.to),
      queryFn: async ({ signal }) => overlay(await fetchPeriod(r.from, r.to, signal)),
      staleTime: 30_000,
    });
  }
};

export function usePrefetch(ranges: { from: number; to: number }[], ready: boolean): void {
  const client = useQueryClient();
  const runtime = useRuntime();
  const signature = ranges.map((r) => `${r.from}-${r.to}`).join();
  useEffect(() => {
    if (!ready) return;
    // Wait for the browser to be idle so prefetching never competes with what the user is doing.
    const id = (window.requestIdleCallback ?? ((fn: () => void) => window.setTimeout(fn, 200)))(
      () => prefetchPeriods(client, ranges, runtime?.overlay),
    );
    return () => (window.cancelIdleCallback ?? window.clearTimeout)(id as number);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `signature` stands for the contents of `ranges`
  }, [client, ready, signature, runtime]);
}

/** One event (the master of a series) as the server has it. */
export async function fetchEvent(id: string): Promise<EventDto | null> {
  const r = await api.get<{ event: EventDto }>(`/api/events/${id}`);
  return r.ok ? r.data.event : null;
}
