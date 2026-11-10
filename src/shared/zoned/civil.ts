/**
 * Calendar arithmetic on civil dates (year, month, day) with no time zone and no `Date`.
 * Algorithms: Howard Hinnant's days_from_civil / civil_from_days (proleptic Gregorian).
 */
export type Civil = { y: number; m: number; d: number };

/** ISO weekday: Monday = 1 ... Sunday = 7. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const daysFromCivil = ({ y, m, d }: Civil): number => {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
};

export const civilFromDays = (days: number): Civil => {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  );
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return { y: yoe + era * 400 + (m <= 2 ? 1 : 0), m, d };
};

export const isLeapYear = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

export const daysInMonth = (y: number, m: number): number =>
  m === 2 ? (isLeapYear(y) ? 29 : 28) : [4, 6, 9, 11].includes(m) ? 30 : 31;

export const isValidCivil = ({ y, m, d }: Civil): boolean =>
  Number.isInteger(y) &&
  Number.isInteger(m) &&
  Number.isInteger(d) &&
  m >= 1 &&
  m <= 12 &&
  d >= 1 &&
  d <= daysInMonth(y, m);

export const addDays = (c: Civil, n: number): Civil => civilFromDays(daysFromCivil(c) + n);

/** Adds months, clamping the day to the target month's length (Jan 31 + 1 month = Feb 28/29). */
export const addMonths = ({ y, m, d }: Civil, n: number): Civil => {
  const index = y * 12 + (m - 1) + n;
  const ny = Math.floor(index / 12);
  const nm = index - ny * 12 + 1;
  return { y: ny, m: nm, d: Math.min(d, daysInMonth(ny, nm)) };
};

export const dayOfWeek = (c: Civil): Weekday => {
  // 1970-01-01 was a Thursday (4).
  const w = (((daysFromCivil(c) + 3) % 7) + 7) % 7; // 0 = Monday
  return (w + 1) as Weekday;
};

/** Number of days between two civil dates (b - a). */
export const diffDays = (a: Civil, b: Civil): number => daysFromCivil(b) - daysFromCivil(a);

export const compareCivil = (a: Civil, b: Civil): number => daysFromCivil(a) - daysFromCivil(b);
export const sameCivil = (a: Civil, b: Civil): boolean => a.y === b.y && a.m === b.m && a.d === b.d;

/** The first day of the week containing `c`, for a week that starts on `weekStart` (1 = Mon ... 7 = Sun). */
export const startOfWeek = (c: Civil, weekStart: Weekday): Civil =>
  addDays(c, -((dayOfWeek(c) - weekStart + 7) % 7));

export const startOfMonth = ({ y, m }: Civil): Civil => ({ y, m, d: 1 });

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** `YYYY-MM-DD` (the format used in URLs and API dates). */
export const formatCivil = ({ y, m, d }: Civil): string => `${pad(y, 4)}-${pad(m)}-${pad(d)}`;

/** Parses `YYYY-MM-DD`; null for anything else, including impossible dates like 2026-02-30. */
export const parseCivil = (text: string): Civil | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;
  const c = { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
  return isValidCivil(c) ? c : null;
};
