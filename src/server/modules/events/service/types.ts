import type { Authed } from '@/server/modules/auth';
import type { EventDto } from '../dto';

/** The caller of a mutation: who they are and the clock to use. */
export type Ctx = Authed;
export type MutationResult = { events: EventDto[]; deletedEventIds: string[] };
