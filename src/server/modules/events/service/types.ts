import type { Authed } from '@/server/modules/auth';
import type { MutationResult } from '@/shared/contracts';

/** The caller of a mutation: who they are and the clock to use. */
export type Ctx = Authed;
export type { MutationResult };
