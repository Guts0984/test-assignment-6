import { getRequestConfig } from 'next-intl/server';

export const locales = ['uk', 'en'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'uk';

export function isLocale(value: string | undefined): value is Locale {
  return locales.some((l) => l === value);
}

// Stage 7 replaces this with per-user/URL locale resolution.
export default getRequestConfig(async () => {
  const locale = defaultLocale;
  return { locale, messages: (await import(`../../../messages/${locale}.json`)).default };
});
