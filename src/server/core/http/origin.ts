import type { NextRequest } from 'next/server';

/**
 * CSRF defence in depth on top of SameSite=Lax: a browser-sent Origin must match the Host the
 * request was addressed to. Requests without Origin (curl, server-to-server) pass.
 */
export function isSameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.get('host');
  } catch {
    return false;
  }
}
