import { authDeps, makeListUsersHandler } from '@/server/modules/auth/http';

export const dynamic = 'force-dynamic';
export const GET = makeListUsersHandler(authDeps);
