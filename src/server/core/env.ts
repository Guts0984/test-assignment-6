import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.url().default('http://localhost:3000'),
  DEFAULT_LOCALE: z.enum(['uk', 'en']).default('uk'),

  POSTGRES_USER: z.string().min(1).default('calendar'),
  POSTGRES_DB: z.string().min(1).default('calendar'),
  POSTGRES_HOST: z.string().min(1).default('localhost'),
  POSTGRES_PORT: z.coerce.number().int().min(1).max(65535).default(5432),
  POSTGRES_PASSWORD: z.string().min(1),
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, 'must be a postgres:// URL'),

  SESSION_SECRET: z.string().min(32, 'must be at least 32 characters'),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(14),
  // Reverse proxies in front of the app that we run ourselves (and that append to X-Forwarded-For). 0 means
  // the app is reached directly and that header is not believed at all.
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),

  SEED_USER_PASSWORD: z.string().min(8),
});

export type Env = z.infer<typeof schema>;

export type EnvError = Error & { name: 'EnvError'; issues: string[] };

export function createEnvError(issues: string[]): EnvError {
  const message = `Invalid environment:\n${issues.map((i) => `  - ${i}`).join('\n')}\nCopy .env.example to .env.`;
  return Object.assign(new Error(message), { name: 'EnvError' as const, issues });
}

export const isEnvError = (e: unknown): e is EnvError =>
  e instanceof Error && e.name === 'EnvError';

export function parseEnv(source: Record<string, string | undefined>): Env {
  // Treat empty strings as unset so `FOO=` falls back to defaults.
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== ''));
  const result = schema.safeParse(cleaned);
  if (!result.success) {
    throw createEnvError(result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  }
  return result.data;
}

let cached: Env | undefined;
/** Lazy so that `next build` does not require secrets unless a route actually uses them. */
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
