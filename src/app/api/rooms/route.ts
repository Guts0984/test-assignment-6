import { authDeps } from '@/server/modules/auth/http';
import { makeListRoomsHandler } from '@/server/modules/rooms/http';

export const dynamic = 'force-dynamic';
export const GET = makeListRoomsHandler(authDeps);
