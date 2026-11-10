import { getTranslations } from 'next-intl/server';

export default async function HomePage() {
  const t = await getTranslations('app');
  return (
    <main className="p-6">
      <h1 className="text-xl font-semibold">{t('title')}</h1>
    </main>
  );
}
