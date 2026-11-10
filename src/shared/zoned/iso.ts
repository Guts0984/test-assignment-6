import { daysFromCivil, isValidCivil } from './civil';
import { localFromUtcMs, localAsUtc, type Local } from './zone';

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/**
 * Parses an ISO 8601 instant that has an offset (`...Z`, `...+02:00`, `...+0200`, `...+02`) into
 * epoch milliseconds. Postgres' `2026-03-30 07:00:00+00` form is accepted too. Returns null for
 * anything else (no offset, impossible date): a wall-clock string is NOT an instant.
 */
export function parseInstant(text: string): number | null {
  const m =
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}(?::?\d{2})?)$/i.exec(
      text.trim(),
    );
  if (!m) return null;
  const [y, mo, d, h, mi] = [m[1], m[2], m[3], m[4], m[5]].map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const s = Number(m[6] ?? 0);
  if (!isValidCivil({ y, m: mo, d }) || h > 23 || mi > 59 || s > 59) return null;
  const ms = Math.floor(Number(`0.${m[7] ?? '0'}`) * 1000 + 1e-9);
  let offset = 0;
  const zone = m[8] as string;
  if (zone.toUpperCase() !== 'Z') {
    const sign = zone.startsWith('-') ? -1 : 1;
    const digits = zone.slice(1).replace(':', '');
    const oh = Number(digits.slice(0, 2));
    const om = Number(digits.slice(2) || 0);
    if (oh > 23 || om > 59) return null;
    offset = sign * (oh * 60 + om) * 60_000;
  }
  return (
    daysFromCivil({ y, m: mo, d }) * 86_400_000 +
    h * 3_600_000 +
    mi * 60_000 +
    s * 1000 +
    ms -
    offset
  );
}

/** `2026-03-30T07:00:00Z`, with fractional seconds only when present (same text Temporal prints). */
export function formatInstant(ms: number): string {
  const whole = Math.floor(ms / 1000) * 1000;
  const frac = ms - whole;
  const l = localFromUtcMs(whole);
  const base = `${pad(l.y, 4)}-${pad(l.m)}-${pad(l.d)}T${pad(l.h)}:${pad(l.mi)}:${pad(l.s)}`;
  return frac === 0 ? `${base}Z` : `${base}.${pad(frac, 3).replace(/0+$/, '')}Z`;
}

/** `2026-03-30T09:00` (seconds only when non-zero): a wall-clock time without zone. */
export const formatLocal = (l: Local): string =>
  `${pad(l.y, 4)}-${pad(l.m)}-${pad(l.d)}T${pad(l.h)}:${pad(l.mi)}${l.s ? `:${pad(l.s)}` : ''}`;

export const parseLocal = (text: string): Local | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text);
  if (!m) return null;
  const l = { y: +m[1]!, m: +m[2]!, d: +m[3]!, h: +m[4]!, mi: +m[5]!, s: +(m[6] ?? 0) };
  return isValidCivil(l) && l.h < 24 && l.mi < 60 && l.s < 60 ? l : null;
};

export { localAsUtc };
