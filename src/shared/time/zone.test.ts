// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { isValidTimeZone } from './zone';

describe('isValidTimeZone', () => {
  it.each([
    'Europe/Kyiv',
    'America/New_York',
    'Asia/Tokyo',
    'UTC',
    'America/Argentina/Buenos_Aires',
    'America/Port-au-Prince',
    'Etc/GMT+5',
  ])('accepts %s', (z) => expect(isValidTimeZone(z)).toBe(true));

  it.each([
    '',
    ' ',
    'Mars/Phobos',
    'Europe/',
    '/Kyiv',
    '+02:00',
    '-05:00',
    'Europe/Kyiv ',
    'europe/kyiv/../x',
    'EST5EDT; drop table',
    '2026-01-01',
    'Europe/Kyiv[u-ca=iso8601]',
  ])('rejects %j (offsets and garbage are not IANA zones)', (z) =>
    expect(isValidTimeZone(z)).toBe(false),
  );

  it('is case-insensitive about names the way IANA lookups are (does not throw)', () => {
    expect(() => isValidTimeZone('europe/kyiv')).not.toThrow();
  });
});
