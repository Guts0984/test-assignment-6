// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { deviceCookieName, deviceCookieValue, isKnownDevice } from './device';

const SECRET = 's'.repeat(40);

describe('known-browser cookie', () => {
  it('is recognised for the account it was made for, whatever the case or spaces of the e-mail', () => {
    const value = deviceCookieValue(SECRET, 'ana@example.com');
    expect(isKnownDevice(SECRET, 'ana@example.com', value)).toBe(true);
    expect(isKnownDevice(SECRET, '  Ana@Example.COM ', value)).toBe(true);
  });

  it('is not valid for another account, another secret, a changed value or no value', () => {
    const value = deviceCookieValue(SECRET, 'ana@example.com');
    expect(isKnownDevice(SECRET, 'bob@example.com', value)).toBe(false);
    expect(isKnownDevice('t'.repeat(40), 'ana@example.com', value)).toBe(false);
    expect(isKnownDevice(SECRET, 'ana@example.com', value.slice(0, -1) + 'A')).toBe(false);
    expect(isKnownDevice(SECRET, 'ana@example.com', '')).toBe(false);
    expect(isKnownDevice(SECRET, 'ana@example.com', undefined)).toBe(false);
  });

  it('has a cookie name per account that does not reveal the e-mail address', () => {
    const name = deviceCookieName(SECRET, 'ana@example.com');
    expect(name).toMatch(/^dev-[0-9a-f]{16}$/);
    expect(name).not.toContain('ana');
    expect(deviceCookieName(SECRET, 'bob@example.com')).not.toBe(name);
  });
});
