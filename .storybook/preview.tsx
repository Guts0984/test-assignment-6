import type { Decorator, Preview } from '@storybook/react-vite';
import { NextIntlClientProvider } from 'next-intl';
import { mswLoader } from 'msw-storybook-addon/csf3';
import { apiHandlers } from '../src/shared/mocks/handlers';
import en from '../messages/en.json';
import uk from '../messages/uk.json';
import '../src/app/globals.css';

const catalogs = { en, uk } as const;

const withIntl: Decorator = (Story, context) => {
  const locale = context.globals.locale === 'en' ? 'en' : 'uk';
  const theme = context.globals.theme === 'dark' ? 'dark' : 'light';
  document.documentElement.lang = locale;
  document.documentElement.dataset.theme = theme;
  return (
    <NextIntlClientProvider locale={locale} messages={catalogs[locale]}>
      <Story />
    </NextIntlClientProvider>
  );
};

const preview: Preview = {
  decorators: [withIntl],
  loaders: [mswLoader()],
  globalTypes: {
    locale: { toolbar: { title: 'Language', items: ['uk', 'en'], dynamicTitle: true } },
    theme: { toolbar: { title: 'Theme', items: ['light', 'dark'], dynamicTitle: true } },
  },
  initialGlobals: { locale: 'en', theme: 'light' },
  // Stories talk to the same mocked API as the unit tests (src/shared/mocks/handlers.ts).
  parameters: { msw: apiHandlers(), layout: 'padded' },
};
export default preview;
