import { z } from 'zod';
import { isValidTimeZone } from '@/shared/time';

export const loginSchema = z.strictObject({
  email: z.string().trim().pipe(z.email()),
  password: z.string().min(1).max(200),
});

/** Strict: only these fields can be changed, so `email`, `id`, `passwordHash` cannot be injected. */
export const profileSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(100),
    timezone: z.string().refine(isValidTimeZone, 'must be an IANA time zone, e.g. Europe/Kyiv'),
    locale: z.enum(['uk', 'en']),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'nothing to update');
