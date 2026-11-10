import type { NextRequest, NextResponse } from 'next/server';
import { json } from '@/server/core/http';
import { authorize, isDenied, type AuthDeps } from '../guard';
import { listUsers } from '../user';

export const makeListUsersHandler =
  (deps: AuthDeps) =>
  async (req: NextRequest): Promise<NextResponse> => {
    const auth = await authorize(deps, req, { mutating: false });
    return isDenied(auth) ? auth : json({ users: await listUsers(deps.db()) });
  };
