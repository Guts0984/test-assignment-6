'use client';

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import type { Scope } from '@/shared/contracts';
import { focusInitial } from '@/shared/focus-initial';
import { useUi } from '../state/ui-store';

/**
 * "Only this / this and following / all" for recurring events. A native <dialog>: showModal() traps focus
 * and Escape cancels; when it closes the browser returns focus to what was focused before it opened.
 * Loaded on demand (lazy), it is not part of the first-load JavaScript.
 */
export default function ScopeDialog() {
  const prompt = useUi((s) => s.scopePrompt);
  const t = useTranslations('scope');
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || !prompt) return;
    if (!dialog.open) {
      dialog.showModal();
      focusInitial(dialog);
    }
    return () => {
      if (dialog.open) dialog.close();
    };
  }, [prompt]);

  if (!prompt) return null;
  const choose = (scope: Scope | null) => prompt.resolve(scope);
  const options: Scope[] = prompt.allowAll ? ['this', 'following', 'all'] : ['this', 'following'];
  const btn =
    'w-full rounded-md border border-border px-3 py-2 text-left hover:bg-muted focus-visible:bg-muted';

  return (
    <dialog
      ref={ref}
      data-testid="scope-dialog"
      aria-labelledby="scope-title"
      onCancel={(e) => {
        e.preventDefault();
        choose(null);
      }}
      className="border-border bg-surface text-foreground m-auto w-[min(26rem,calc(100vw-2rem))] rounded-lg border p-5 backdrop:bg-black/40"
    >
      <h2 id="scope-title" className="text-base font-semibold">
        {prompt.kind === 'delete' ? t('deleteTitle') : t('editTitle')}
      </h2>
      <p className="text-muted-foreground mt-1 text-sm">{t('question', { title: prompt.title })}</p>
      <div className="mt-4 flex flex-col gap-2">
        {options.map((scope, i) => (
          <button
            key={scope}
            type="button"
            data-autofocus={i === 0 ? '' : undefined}
            className={btn}
            data-testid={`scope-${scope}`}
            onClick={() => choose(scope)}
          >
            {t(scope)}
          </button>
        ))}
        <button
          type="button"
          className={`${btn} text-muted-foreground`}
          data-testid="scope-cancel"
          onClick={() => choose(null)}
        >
          {t('cancel')}
        </button>
      </div>
    </dialog>
  );
}
