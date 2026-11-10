import { cookies } from 'next/headers';
import { getPageUser } from '@/server/modules/auth/http';
import type { PublicUser } from '@/shared/contracts';
import { isValidZone } from '@/shared/zoned';
import {
  defaultClock,
  defaultLocale,
  isClock,
  isLocale,
  type ClockStyle,
  type Locale,
} from '@/shared/i18n/config';

export type Theme = 'system' | 'light' | 'dark';

export type PageSettings = {
  user: PublicUser | null;
  locale: Locale;
  /** The profile zone (UTC for anonymous pages). The browser's zone is never consulted. */
  timeZone: string;
  clock: ClockStyle;
  theme: Theme;
  /** Optional second time axis (a cookie: a viewing preference, not part of the profile). */
  tz2: string | null;
};

/** Everything a server-rendered page needs to render identically on the server and in the browser. */
export async function getPageSettings(): Promise<PageSettings> {
  const [user, jar] = await Promise.all([getPageUser(), cookies()]);
  const locale = isLocale(user?.locale)
    ? user.locale
    : isLocale(jar.get('locale')?.value)
      ? (jar.get('locale')!.value as Locale)
      : defaultLocale;
  const clockCookie = jar.get('clock')?.value;
  const themeCookie = jar.get('theme')?.value;
  return {
    user,
    locale,
    timeZone: user?.timezone ?? 'UTC',
    clock: isClock(clockCookie) ? clockCookie : defaultClock(locale),
    theme: themeCookie === 'light' || themeCookie === 'dark' ? themeCookie : 'system',
    tz2: isValidZone(jar.get('tz2')?.value ?? '') ? (jar.get('tz2')?.value ?? null) : null,
  };
}
