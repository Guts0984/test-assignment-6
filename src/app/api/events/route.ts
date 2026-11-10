import { authDeps } from '@/server/modules/auth/http';
import { makeCreateEventHandler, makeListEventsHandler } from '@/server/modules/events/http';

export const dynamic = 'force-dynamic';
export const GET = makeListEventsHandler(authDeps);
export const POST = makeCreateEventHandler(authDeps);
