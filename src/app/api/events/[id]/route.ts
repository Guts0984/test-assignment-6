import { authDeps } from '@/server/modules/auth/http';
import {
  makeDeleteEventHandler,
  makeGetEventHandler,
  makeUpdateEventHandler,
} from '@/server/modules/events/http';

export const dynamic = 'force-dynamic';
export const GET = makeGetEventHandler(authDeps);
export const PATCH = makeUpdateEventHandler(authDeps);
export const DELETE = makeDeleteEventHandler(authDeps);
