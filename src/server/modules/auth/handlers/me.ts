import type { NextRequest, NextResponse } from 'next/server';
import { json, parseBody } from '@/server/core/http';
import { authorize, isDenied, type AuthDeps } from '../guard';
import { updateProfile } from '../user';
import { profileSchema } from '../validation';

export const makeGetMeHandler =
  (deps: AuthDeps) =>
  async (req: NextRequest): Promise<NextResponse> => {
    const auth = await authorize(deps, req, { mutating: false });
    return isDenied(auth) ? auth : json({ user: auth.user });
  };

export const makeUpdateMeHandler =
  (deps: AuthDeps) =>
  async (req: NextRequest): Promise<NextResponse> => {
    const auth = await authorize(deps, req, { mutating: true });
    if (isDenied(auth)) return auth;
    const body = await parseBody(req, profileSchema);
    if (!body.ok) return body.response;
    return json({ user: (await updateProfile(deps.db(), auth.user.id, body.data)) ?? auth.user });
  };
