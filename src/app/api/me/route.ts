import { authDeps, makeGetMeHandler, makeUpdateMeHandler } from '@/server/modules/auth/http';

export const dynamic = 'force-dynamic';
export const GET = makeGetMeHandler(authDeps);
export const PATCH = makeUpdateMeHandler(authDeps);
