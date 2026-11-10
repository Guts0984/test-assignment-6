import { authDeps, makeLogoutHandler } from '@/server/modules/auth/http';

export const dynamic = 'force-dynamic';
export const POST = makeLogoutHandler(authDeps);
