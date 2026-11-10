import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { getPageUser } from '@/server/modules/auth/http';
import { defaultLocale, isLocale } from '@/shared/i18n/config';

/**
 * The locale comes from the user's PROFILE (so it follows them across devices and the very first
 * server render already speaks their language), then from a cookie for the login page, then the default.
 */
export default getRequestConfig(async () => {
  const user = await getPageUser();
  const cookieLocale = (await cookies()).get('locale')?.value;
  const locale = isLocale(user?.locale)
    ? user.locale
    : isLocale(cookieLocale)
      ? cookieLocale
      : defaultLocale;
  return {
    locale,
    timeZone: user?.timezone ?? 'UTC',
    messages: (await import(`../../../messages/${locale}.json`)).default,
  };
});
