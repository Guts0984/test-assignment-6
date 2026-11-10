import { authDeps, makeLoginHandler } from '@/server/modules/auth/http';

export const dynamic = 'force-dynamic';
export const POST = makeLoginHandler(authDeps);
