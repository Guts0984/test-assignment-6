'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { ClockStyle } from '@/shared/i18n/config';
import type { Weekday } from '@/shared/zoned';
import type { Names } from './format';

/** What every calendar component needs to know about HOW to show things. Changes rarely. */
export type CalendarEnv = {
  /** The viewer's zone from the profile: all placement and all labels use it, never the browser's. */
  tz: string;
  /** Optional second time axis. */
  tz2: string | null;
  locale: string;
  clock: ClockStyle;
  weekStart: Weekday;
  names: Names;
  userId: string;
};

const EnvContext = createContext<CalendarEnv | null>(null);

export function EnvProvider({ value, children }: { value: CalendarEnv; children: ReactNode }) {
  return <EnvContext.Provider value={value}>{children}</EnvContext.Provider>;
}

export function useEnv(): CalendarEnv {
  const env = useContext(EnvContext);
  if (!env) throw new Error('useEnv must be used inside <EnvProvider>');
  return env;
}
