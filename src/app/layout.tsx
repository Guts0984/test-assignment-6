import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { getPageSettings } from './settings';
import './globals.css';

export const metadata: Metadata = { title: 'Room calendar' };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const { locale, theme } = await getPageSettings();
  const messages = await getMessages();
  return (
    <html lang={locale} data-theme={theme === 'system' ? undefined : theme}>
      <body>
        <NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
