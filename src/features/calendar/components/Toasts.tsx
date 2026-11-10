'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { parseInstant } from '@/shared/zoned';
import { useEnv } from '../context';
import { timeRange } from '../format';
import { useUi, type Toast } from '../state/ui-store';

const LIFETIME_MS = 9_000;

function ToastItem({ toast }: { toast: Toast }) {
  const t = useTranslations('errors');
  const dismiss = useUi((s) => s.dismissToast);
  const { tz, clock, names } = useEnv();
  useEffect(() => {
    const id = window.setTimeout(() => dismiss(toast.id), LIFETIME_MS);
    return () => window.clearTimeout(id);
  }, [toast.id, dismiss]);

  // A room conflict names the booking that is in the way and shows its time in the viewer's zone.
  const params = { ...toast.params } as Record<string, string | number>;
  if (typeof params.start === 'string' && typeof params.end === 'string') {
    const [s, e] = [parseInstant(params.start), parseInstant(params.end)];
    if (s !== null && e !== null) params.time = timeRange(s, e, tz, clock, names.time);
  }
  return (
    <li
      role={toast.kind === 'error' ? 'alert' : 'status'}
      data-testid="toast"
      data-code={toast.code}
      className={`pointer-events-auto flex items-start gap-3 rounded-lg border px-4 py-3 text-sm shadow-lg ${toast.kind === 'error' ? 'border-destructive bg-surface text-foreground' : 'border-border bg-surface'}`}
    >
      <span className="flex-1">{t(toast.code, params)}</span>
      <button
        type="button"
        className="text-muted-foreground hover:bg-muted rounded px-1"
        onClick={() => dismiss(toast.id)}
        aria-label="×"
      >
        ×
      </button>
    </li>
  );
}

export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  return (
    <ul className="pointer-events-none fixed bottom-4 left-1/2 z-50 flex w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 flex-col gap-2">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </ul>
  );
}

/** Announces actions to screen readers. Visually hidden. */
export function LiveRegion() {
  const text = useUi((s) => s.announcement);
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
      data-testid="live-region"
    >
      {text}
    </div>
  );
}
