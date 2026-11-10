import { makeGetMeHandler, makeUpdateMeHandler } from '@/server/auth/handlers';
import { authDeps } from '@/server/auth/wiring';

export const dynamic = 'force-dynamic';
export const GET = makeGetMeHandler(authDeps);
export const PATCH = makeUpdateMeHandler(authDeps);
