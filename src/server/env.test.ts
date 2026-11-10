// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EnvError, parseEnv } from './env';

const secrets = {
  POSTGRES_PASSWORD: 'pw',
  DATABASE_URL: 'postgres://u:pw@localhost:5432/db',
  SESSION_SECRET: 'x'.repeat(32),
  SEED_USER_PASSWORD: 'demo1234',
};

/** Minimal dotenv parser, good enough for our flat KEY=VALUE example file. */
function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const m = /^\s*([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m?.[1]) out[m[1]] = m[2] ?? '';
  }
  return out;
}

describe('parseEnv', () => {
  it('applies defaults for non-secrets when only secrets are given', () => {
    const env = parseEnv(secrets);
    expect(env).toMatchObject({
      NODE_ENV: 'development',
      DEFAULT_LOCALE: 'uk',
      POSTGRES_PORT: 5432,
      SESSION_TTL_DAYS: 14,
    });
  });

  it('does not invent defaults for secrets and reports every missing one', () => {
    try {
      parseEnv({});
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(EnvError);
      const issues = (e as EnvError).issues.join('\n');
      for (const k of Object.keys(secrets)) expect(issues).toContain(k);
    }
  });

  it('treats empty string as unset (falls back to default, still fails for secrets)', () => {
    expect(parseEnv({ ...secrets, POSTGRES_PORT: '' }).POSTGRES_PORT).toBe(5432);
    expect(() => parseEnv({ ...secrets, SESSION_SECRET: '' })).toThrow(EnvError);
  });

  it('coerces numbers and rejects out-of-range / non-numeric values', () => {
    expect(parseEnv({ ...secrets, POSTGRES_PORT: '6543' }).POSTGRES_PORT).toBe(6543);
    expect(() => parseEnv({ ...secrets, POSTGRES_PORT: '70000' })).toThrow(EnvError);
    expect(() => parseEnv({ ...secrets, POSTGRES_PORT: 'abc' })).toThrow(EnvError);
    expect(() => parseEnv({ ...secrets, SESSION_TTL_DAYS: '0' })).toThrow(EnvError);
  });

  it('rejects a short session secret and a non-postgres URL', () => {
    expect(() => parseEnv({ ...secrets, SESSION_SECRET: 'short' })).toThrow(EnvError);
    expect(() => parseEnv({ ...secrets, DATABASE_URL: 'mysql://x' })).toThrow(EnvError);
  });

  it('rejects an unsupported default locale', () => {
    expect(() => parseEnv({ ...secrets, DEFAULT_LOCALE: 'de' })).toThrow(EnvError);
  });
});

describe('.env.example', () => {
  const example = parseDotenv(readFileSync(resolve(process.cwd(), '.env.example'), 'utf8'));

  it('is valid according to the schema (cp .env.example .env must work)', () => {
    expect(() => parseEnv(example)).not.toThrow();
  });

  it('DATABASE_URL is consistent with the POSTGRES_* variables used by docker compose', () => {
    const url = new URL(example.DATABASE_URL ?? '');
    expect(decodeURIComponent(url.username)).toBe(example.POSTGRES_USER);
    expect(decodeURIComponent(url.password)).toBe(example.POSTGRES_PASSWORD);
    expect(url.hostname).toBe(example.POSTGRES_HOST);
    expect(url.port).toBe(example.POSTGRES_PORT);
    expect(url.pathname.slice(1)).toBe(example.POSTGRES_DB);
  });
});
