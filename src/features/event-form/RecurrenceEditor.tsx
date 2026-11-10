'use client';

import { useTranslations } from 'next-intl';
import type { Control } from 'react-hook-form';
import { Controller } from 'react-hook-form';
import { WEEKDAY_CODES, type FormValues, type RepeatKind, type WeekdayCode } from './form-model';

const field = 'rounded-md border border-border bg-surface px-2 py-1.5 text-sm';

/**
 * Interval, weekdays and end of a repeat. Lazy-loaded: only people who pick "repeat" download it, so
 * the first-load budget does not pay for it.
 */
export default function RecurrenceEditor({
  control,
  kind,
  weekStartFirst,
  startDay,
}: {
  control: Control<FormValues>;
  kind: RepeatKind;
  weekStartFirst: number;
  /** The weekday of the first occurrence: always part of a weekly rule, so it is shown on and locked. */
  startDay?: WeekdayCode;
}) {
  const t = useTranslations('form');
  const tw = useTranslations('weekdaysCode');
  const order = [
    ...WEEKDAY_CODES.slice(weekStartFirst - 1),
    ...WEEKDAY_CODES.slice(0, weekStartFirst - 1),
  ];
  const unit =
    kind === 'daily' ? 'intervalDaily' : kind === 'weekly' ? 'intervalWeekly' : 'intervalMonthly';

  return (
    <div
      className="border-border flex flex-col gap-3 rounded-md border p-3"
      data-testid="recurrence-editor"
    >
      <Controller
        control={control}
        name="repeat.interval"
        render={({ field: f }) => (
          <label className="flex items-center gap-2 text-sm">
            {t('every')}
            <input
              type="number"
              min={1}
              max={99}
              className={`${field} w-16`}
              value={f.value}
              onChange={(e) => f.onChange(e.target.value === '' ? NaN : Number(e.target.value))}
              data-testid="repeat-interval"
            />
            <span className="text-muted-foreground">
              {t(unit, { count: Number.isFinite(f.value) ? f.value : 1 })}
            </span>
          </label>
        )}
      />
      {kind === 'weekly' && (
        <Controller
          control={control}
          name="repeat.weekdays"
          render={({ field: f }) => (
            <fieldset className="text-sm">
              <legend className="mb-1">{t('onDays')}</legend>
              <div className="flex flex-wrap gap-1">
                {order.map((code) => {
                  const locked = code === startDay;
                  const on = locked || f.value.includes(code);
                  return (
                    <label
                      key={code}
                      title={locked ? t('startDayLocked') : undefined}
                      className={`rounded-md border px-2 py-1 ${locked ? 'cursor-not-allowed opacity-80' : 'cursor-pointer'} ${on ? 'border-primary bg-primary text-primary-foreground' : 'border-border'}`}
                    >
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={on}
                        disabled={locked}
                        onChange={() =>
                          f.onChange(on ? f.value.filter((d) => d !== code) : [...f.value, code])
                        }
                        data-testid={`weekday-${code}`}
                      />
                      {tw(code)}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          )}
        />
      )}
      <Controller
        control={control}
        name="repeat.end"
        render={({ field: f }) => (
          <fieldset className="flex flex-col gap-2 text-sm">
            <legend className="mb-1">{t('ends')}</legend>
            {(['never', 'until', 'count'] as const).map((k) => (
              <label key={k} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="repeat-end"
                  checked={f.value.kind === k}
                  onChange={() =>
                    f.onChange(
                      k === 'never'
                        ? { kind: 'never' }
                        : k === 'until'
                          ? { kind: 'until', until: '' }
                          : { kind: 'count', count: 10 },
                    )
                  }
                  data-testid={`end-${k}`}
                />
                {k === 'never' ? t('endsNever') : k === 'until' ? t('endsOn') : t('endsAfter')}
                {k === 'until' && f.value.kind === 'until' && (
                  <input
                    type="date"
                    aria-label={t('until')}
                    className={field}
                    value={f.value.until}
                    onChange={(e) => f.onChange({ kind: 'until', until: e.target.value })}
                    data-testid="end-until-date"
                  />
                )}
                {k === 'count' && f.value.kind === 'count' && (
                  <input
                    type="number"
                    min={1}
                    max={1000}
                    aria-label={t('count')}
                    className={`${field} w-20`}
                    value={f.value.count}
                    onChange={(e) =>
                      f.onChange({
                        kind: 'count',
                        count: e.target.value === '' ? NaN : Number(e.target.value),
                      })
                    }
                    data-testid="end-count-value"
                  />
                )}
              </label>
            ))}
          </fieldset>
        )}
      />
    </div>
  );
}
