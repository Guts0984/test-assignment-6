export const locales = ['uk', 'en'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'uk';

export function isLocale(value: string | undefined | null): value is Locale {
  return locales.some((l) => l === value);
}

/** 24-hour clock is the norm in Ukraine, the 12-hour clock in the English (US) locale. */
export type ClockStyle = '12h' | '24h';
export const defaultClock = (locale: Locale): ClockStyle => (locale === 'en' ? '12h' : '24h');
export const isClock = (v: string | undefined | null): v is ClockStyle =>
  v === '12h' || v === '24h';
