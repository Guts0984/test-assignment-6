// @vitest-environment node
import { Temporal } from '@js-temporal/polyfill';
import { describe, expect, it } from 'vitest';
import { isSupportedWindow, MAX_YEARS_AHEAD } from './window';

const now = Temporal.Instant.from('2026-11-10T12:00:00Z');
const at = (iso: string) => Temporal.Instant.from(iso);

describe('isSupportedWindow', () => {
  it('accepts a window around today', () => {
    expect(isSupportedWindow(at('2026-11-01T00:00:00Z'), at('2026-12-01T00:00:00Z'), now)).toBe(
      true,
    );
  });

  it('accepts up to exactly five years ahead and behind, and refuses anything beyond', () => {
    expect(MAX_YEARS_AHEAD).toBe(5);
    expect(isSupportedWindow(at('2031-11-01T00:00:00Z'), at('2031-11-10T12:00:00Z'), now)).toBe(
      true,
    );
    expect(isSupportedWindow(at('2031-11-01T00:00:00Z'), at('2031-11-10T12:00:01Z'), now)).toBe(
      false,
    );
    expect(isSupportedWindow(at('2021-11-10T12:00:00Z'), at('2021-12-01T00:00:00Z'), now)).toBe(
      true,
    );
    expect(isSupportedWindow(at('2021-11-10T11:59:59Z'), at('2021-12-01T00:00:00Z'), now)).toBe(
      false,
    );
  });

  it('refuses the year 9000 and the year 1000', () => {
    expect(isSupportedWindow(at('9000-01-01T00:00:00Z'), at('9000-02-01T00:00:00Z'), now)).toBe(
      false,
    );
    expect(isSupportedWindow(at('1000-01-01T00:00:00Z'), at('1000-02-01T00:00:00Z'), now)).toBe(
      false,
    );
  });
});
