'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { api } from '@/shared/api/client';

export function LoginForm() {
  const t = useTranslations('auth');
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    const result = await api.post('/api/auth/login', {
      email: String(form.get('email')),
      password: String(form.get('password')),
    });
    if (result.ok) {
      router.replace('/calendar');
      router.refresh();
      return;
    }
    setBusy(false);
    setError(result.kind === 'network' ? t('network') : t('invalid'));
  }

  const field =
    'mt-1 block w-full rounded-md border border-border bg-surface px-3 py-2 text-foreground';
  return (
    <form
      onSubmit={submit}
      className="border-border bg-surface mx-auto mt-24 flex max-w-sm flex-col gap-4 rounded-lg border p-6"
    >
      <h1 className="text-xl font-semibold">{t('title')}</h1>
      <label className="text-sm">
        {t('email')}
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          className={field}
          defaultValue="ana@example.com"
        />
      </label>
      <label className="text-sm">
        {t('password')}
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className={field}
        />
      </label>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={busy}
        className="bg-primary text-primary-foreground rounded-md px-3 py-2 font-medium disabled:opacity-60"
      >
        {busy ? t('submitting') : t('submit')}
      </button>
      <p className="text-muted-foreground text-xs">{t('demoHint')}</p>
    </form>
  );
}
