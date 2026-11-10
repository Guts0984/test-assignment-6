import type { NextRequest, NextResponse } from 'next/server';
import { json } from '@/server/core/http';
import { authorize, isDenied, type AuthDeps } from '@/server/modules/auth/http';
import { listRooms } from '../repository';

export const makeListRoomsHandler =
  (deps: AuthDeps) =>
  async (req: NextRequest): Promise<NextResponse> => {
    const ctx = await authorize(deps, req, { mutating: false });
    return isDenied(ctx) ? ctx : json({ rooms: await listRooms(deps.db()) });
  };
