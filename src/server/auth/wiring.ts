import { Temporal } from '@js-temporal/polyfill';
import { getDb } from '../db/client';
import { getEnv } from '../env';
import type { AuthDeps } from './handlers';

/** Production wiring used by the Next.js route files. */
export const authDeps: AuthDeps = {
  db: getDb,
  now: () => Temporal.Now.instant(),
  config: () => {
    const env = getEnv();
    return {
      secret: env.SESSION_SECRET,
      ttlDays: env.SESSION_TTL_DAYS,
      // Secure cookies are not sent over plain http (local docker); enable them behind https.
      secureCookies: env.APP_URL.startsWith('https://'),
    };
  },
};
