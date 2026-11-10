'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { api } from '@/shared/api/client';
import { setPreferenceCookie } from '@/shared/cookies';
import { clearOfflineCache } from '@/shared/register-sw';
import type { PublicUser } from '@/shared/contracts';
import type { ClockStyle } from '@/shared/i18n/config';
import { isValidZone } from '@/shared/zoned';

export type Prefs = {
  tz: string;
  tz2: string | null;
  clock: ClockStyle;
  theme: 'system' | 'light' | 'dark';
};

type Props = {
  user: PublicUser;
  locale: string;
  prefs: Prefs;
  onApply: (prefs: Prefs) => void;
  onClose: () => void;
};

const FEATURED = ['Europe/Kyiv', 'America/New_York', 'Asia/Tokyo', 'UTC'];
const select = 'rounded-md border border-border bg-surface px-3 py-2 text-sm';

function zoneList(): string[] {
  let all: string[] = [];
  try {
    all =
      (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.(
        'timeZone',
      ) ?? [];
  } catch {
    /* older engines */
  }
  return [...new Set([...FEATURED, ...all])].filter(isValidZone);
}

/**
 * Time zone (profile, stored on the server), language (profile), 12/24h, theme and the second axis
 * (cookies). Changing the zone re-lays out the calendar at once, without a reload. Native <dialog>, lazy.
 */
export default function SettingsDialog({ user, locale, prefs, onApply, onClose }: Props) {
  const t = useTranslations('profile');
  const tn = useTranslations('auth');
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const zones = useMemo(() => zoneList(), []);
  const [draft, setDraft] = useState({ ...prefs, locale });
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    opener.current = document.activeElement;
    ref.current?.showModal();
    return () => {
      const el = opener.current;
      queueMicrotask(() => el instanceof HTMLElement && document.contains(el) && el.focus());
    };
  }, []);

  async function save() {
    setSaving(true);
    setFailed(false);
    const changed: { timezone?: string; locale?: string } = {};
    if (draft.tz !== prefs.tz) changed.timezone = draft.tz;
    if (draft.locale !== locale) changed.locale = draft.locale;
    if (Object.keys(changed).length > 0) {
      const r = await api.patch('/api/me', changed);
      if (!r.ok) {
        setSaving(false);
        setFailed(true);
        return;
      }
    }
    setPreferenceCookie('clock', draft.clock);
    setPreferenceCookie('theme', draft.theme === 'system' ? null : draft.theme);
    setPreferenceCookie('tz2', draft.tz2);
    if (draft.theme === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = draft.theme;
    onApply({ tz: draft.tz, tz2: draft.tz2, clock: draft.clock, theme: draft.theme });
    if (draft.locale !== locale) router.refresh(); // the server re-renders in the new language
    onClose();
  }

  async function signOut() {
    await api.post('/api/auth/logout');
    clearOfflineCache();
    router.replace('/login');
    router.refresh();
  }

  return (
    <dialog
      ref={ref}
      data-testid="settings-dialog"
      aria-labelledby="settings-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className="border-border bg-surface text-foreground m-auto w-[min(28rem,calc(100vw-2rem))] rounded-lg border p-5 backdrop:bg-black/40"
    >
      <h2 id="settings-title" className="text-lg font-semibold">
        {t('title')}
      </h2>
      <p className="text-muted-foreground text-sm">
        {user.name} · {user.email}
      </p>
      <div className="mt-4 flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm font-medium">
          {t('timezone')}
          <select
            className={select}
            value={draft.tz}
            onChange={(e) => setDraft({ ...draft, tz: e.target.value })}
            data-testid="setting-timezone"
          >
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
          <span className="text-muted-foreground text-xs font-normal">{t('timezoneHint')}</span>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          {t('secondZone')}
          <select
            className={select}
            value={draft.tz2 ?? ''}
            onChange={(e) => setDraft({ ...draft, tz2: e.target.value || null })}
            data-testid="setting-tz2"
          >
            <option value="">{t('secondZoneNone')}</option>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          {t('language')}
          <select
            className={select}
            value={draft.locale}
            onChange={(e) => setDraft({ ...draft, locale: e.target.value })}
            data-testid="setting-locale"
          >
            <option value="uk">Українська</option>
            <option value="en">English</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          {t('clock')}
          <select
            className={select}
            value={draft.clock}
            onChange={(e) => setDraft({ ...draft, clock: e.target.value as ClockStyle })}
            data-testid="setting-clock"
          >
            <option value="24h">{t('clock24')}</option>
            <option value="12h">{t('clock12')}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          {t('theme')}
          <select
            className={select}
            value={draft.theme}
            onChange={(e) => setDraft({ ...draft, theme: e.target.value as Prefs['theme'] })}
            data-testid="setting-theme"
          >
            <option value="system">{t('themeSystem')}</option>
            <option value="light">{t('themeLight')}</option>
            <option value="dark">{t('themeDark')}</option>
          </select>
        </label>
      </div>
      {failed && (
        <p role="alert" className="text-destructive mt-3 text-sm">
          {tn('network')}
        </p>
      )}
      <div className="mt-5 flex gap-2">
        <button
          type="button"
          className="bg-primary text-primary-foreground rounded-md px-4 py-2 font-medium disabled:opacity-60"
          disabled={saving}
          onClick={save}
          data-testid="settings-save"
        >
          {t('save')}
        </button>
        <button
          type="button"
          className="border-border rounded-md border px-4 py-2"
          onClick={onClose}
        >
          ✕
        </button>
        <button
          type="button"
          className="border-border ml-auto rounded-md border px-4 py-2 text-sm"
          onClick={signOut}
          data-testid="sign-out"
        >
          {tn('signOut')}
        </button>
      </div>
    </dialog>
  );
}
