import { makeLoginHandler } from '@/server/auth/handlers';
import { authDeps } from '@/server/auth/wiring';

export const dynamic = 'force-dynamic';
export const POST = makeLoginHandler(authDeps);
