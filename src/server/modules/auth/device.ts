import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * A "known browser" marker. After a successful sign-in the server gives the browser a cookie that only
 * it can have made: HMAC(secret, e-mail). The sign-in limit uses it so that somebody who types ten wrong
 * passwords for YOUR e-mail address cannot stop you signing in from your usual browser: the limit applies
 * to clients that do not carry the marker for that account (which is what an attacker is).
 */
const mac = (secret: string, label: string, email: string): Buffer =>
  createHmac('sha256', secret).update(`${label}:${email.trim().toLowerCase()}`).digest();

/** The cookie name is per account, so one browser can know several accounts. */
export const deviceCookieName = (secret: string, email: string): string =>
  `dev-${mac(secret, 'name', email).toString('hex').slice(0, 16)}`;

export const deviceCookieValue = (secret: string, email: string): string =>
  mac(secret, 'device', email).toString('base64url');

/** Is `value` the marker for this account? (Constant-time comparison.) */
export function isKnownDevice(secret: string, email: string, value: string | undefined): boolean {
  if (!value) return false;
  const expected = Buffer.from(deviceCookieValue(secret, email));
  const given = Buffer.from(value);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** One year: browsers cap cookie lifetimes anyway. */
export const DEVICE_MAX_AGE_SECONDS = 365 * 24 * 3600;
