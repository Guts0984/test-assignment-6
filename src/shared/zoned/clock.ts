/**
 * Time-of-day formatting and parsing for 12h / 24h clocks, written by hand on purpose: the output of
 * `Intl.DateTimeFormat` for times differs between ICU versions (e.g. U+202F before AM/PM), which would
 * make server-rendered and client-rendered text differ and break hydration.
 */
export type ClockStyle = '12h' | '24h';

export type TimeLabels = { am: string; pm: string };

const pad = (n: number) => String(n).padStart(2, '0');

/** `09:30` (24h) or `9:30 AM` (12h). Hour 24 / minute overflow are not valid here. */
export function formatClock(minutesOfDay: number, style: ClockStyle, labels: TimeLabels): string {
  const h = Math.floor(minutesOfDay / 60) % 24;
  const mi = minutesOfDay % 60;
  if (style === '24h') return `${pad(h)}:${pad(mi)}`;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad(mi)} ${h < 12 ? labels.am : labels.pm}`;
}

/** Whole-hour label for the time axis: `9:00` / `09:00` vs `9 AM`. */
export function formatHour(hour: number, style: ClockStyle, labels: TimeLabels): string {
  if (style === '24h') return `${pad(hour % 24)}:00`;
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12} ${hour % 24 < 12 ? labels.am : labels.pm}`;
}

/**
 * Parses what a person types into a time field: `9`, `930`, `9:30`, `9.30`, `0930`, `21:30`,
 * `9 pm`, `9:30pm`, `12am`. Returns minutes since midnight or null. Rules:
 *  - with am/pm the hour must be 1-12 (12am = 00:00, 12pm = 12:00);
 *  - without it the hour is 0-23, so "9" is 09:00 in both styles (never guess PM);
 *  - 24:00 is not accepted.
 */
export function parseClock(input: string, labels: TimeLabels): number | null {
  const text = input.trim().toLowerCase().replace(/\s+/g, ' ');
  const meridiemOf = (suffix: string): 'am' | 'pm' | null => {
    const s = suffix.replace(/[. ]/g, '');
    if (s === labels.am.toLowerCase().replace(/[. ]/g, '') || s === 'am' || s === 'a') return 'am';
    if (s === labels.pm.toLowerCase().replace(/[. ]/g, '') || s === 'pm' || s === 'p') return 'pm';
    return null;
  };
  const m = /^(\d{1,2})(?:[:.]?(\d{2}))?\s*([a-zа-яіїєґ.]*)$/i.exec(text);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = m[2] === undefined ? 0 : Number(m[2]);
  if (minute > 59) return null;
  // "930" is 9:30, but a bare 3-4 digit run is only a time when it splits into valid hour + minutes.
  if (m[3] === '') {
    if (hour > 23) return null;
    return hour * 60 + minute;
  }
  const meridiem = meridiemOf(m[3] as string);
  if (!meridiem || hour < 1 || hour > 12) return null;
  return ((hour % 12) + (meridiem === 'pm' ? 12 : 0)) * 60 + minute;
}
