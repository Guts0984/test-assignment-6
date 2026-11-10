import { Temporal } from '@js-temporal/polyfill';

/**
 * True for IANA zone names ("Europe/Kyiv", "UTC"). Temporal also accepts fixed offsets like
 * "+02:00" as zones; those are rejected because they have no DST rules and would silently break
 * recurring events.
 */
export function isValidTimeZone(value: string): boolean {
  if (!/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)*$/.test(value)) return false;
  try {
    Temporal.Now.zonedDateTimeISO(value);
    return true;
  } catch {
    return false;
  }
}
