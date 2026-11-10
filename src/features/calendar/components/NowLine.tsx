'use client';

import { useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import { dayOf } from '../domain/segments';
import { minutesToPx } from '../domain/grid';
import { toLocal, sameCivil, type Civil } from '@/shared/zoned';
import { useEnv } from '../context';
import { PX_PER_HOUR } from './EventBlock';

// One shared clock for the whole page, ticking every 30 s while anything is subscribed. The server
// snapshot is `null`, so server and first client render agree and the line appears after hydration.
let current: number | null = null;
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();
const TICK_MS = 30_000;

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  if (timer === undefined) {
    current = Date.now();
    timer = setInterval(() => {
      current = Date.now();
      listeners.forEach((l) => l());
    }, TICK_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  };
};

/** The current time (epoch ms), updating on its own; null on the server and during hydration. */
export const useNow = (): number | null =>
  useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );

/** The red "now" line. Only this component re-renders when the clock ticks. */
export function NowLine({ date }: { date: Civil }) {
  const { tz } = useEnv();
  const t = useTranslations('calendar');
  const now = useNow();
  if (now === null || !sameCivil(dayOf(now, tz), date)) return null;
  const l = toLocal(now, tz);
  const top = minutesToPx(l.h * 60 + l.mi + l.s / 60, PX_PER_HOUR);
  return (
    <div
      role="img"
      aria-label={t('nowLine')}
      data-testid="now-line"
      className="bg-now pointer-events-none absolute inset-x-0 z-10 h-0.5"
      style={{ top }}
    >
      <span className="bg-now absolute -top-1 -left-1 h-2.5 w-2.5 rounded-full" />
    </div>
  );
}
