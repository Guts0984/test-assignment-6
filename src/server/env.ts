import { z } from 'zod';

/**
 * Single place where process.env is read. Server-only: never import from client code.
 * Non-secret values have defaults; secrets (DATABASE_URL, SESSION_SECRET, SEED_USER_PASSWORD)
 * are required and come from .env (see .env.example).
 */
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

  SEED_USER_PASSWORD: z.string().min(8),
});

export type Env = z.infer<typeof schema>;

export class EnvError extends Error {
  constructor(public readonly issues: string[]) {
    super(
      `Invalid environment:\n${issues.map((i) => `  - ${i}`).join('\n')}\nCopy .env.example to .env.`,
    );
    this.name = 'EnvError';
  }
}

export function parseEnv(source: Record<string, string | undefined>): Env {
  // Treat empty strings as unset so `FOO=` falls back to defaults.
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== ''));
  const result = schema.safeParse(cleaned);
  if (!result.success) {
    throw new EnvError(result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  }
  return result.data;
}

let cached: Env | undefined;
/** Lazy so that `next build` does not require secrets unless a route actually uses them. */
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
