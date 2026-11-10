import type { ApiErrorBody, ApiErrorCode } from '@/shared/contracts';

/**
 * Tiny typed fetch wrapper. It never throws for HTTP errors or a dead network: callers get a value
 * to branch on, which keeps optimistic-update and offline code free of try/catch.
 */
export type ApiOk<T> = { ok: true; status: number; data: T };
export type ApiFailure = {
  ok: false;
  /** `network` = the request did not get an answer (offline, server down). Otherwise an API error. */
  kind: 'network' | 'api';
  status: number;
  code: ApiErrorCode | 'NETWORK' | 'UNKNOWN';
  details?: unknown;
};
export type ApiResult<T> = ApiOk<T> | ApiFailure;

/** Identifies THIS browser tab to the server so it can tell us which SSE messages are our own echoes. */
const newClientId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(9)), (b) => b.toString(36).padStart(2, '0'))
    .join('')
    .slice(0, 16);
let clientId: string | undefined;
export const getClientId = (): string => (clientId ??= newClientId());

export type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export async function request<T>(
  method: Method,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      signal,
      headers: {
        'x-client-id': getClientId(),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if ((error as { name?: string }).name === 'AbortError') throw error; // callers cancel on purpose
    return { ok: false, kind: 'network', status: 0, code: 'NETWORK' };
  }
  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    /* empty or non-JSON body */
  }
  if (response.ok) return { ok: true, status: response.status, data: json as T };
  const error = (json as Partial<ApiErrorBody> | null)?.error;
  return {
    ok: false,
    kind: 'api',
    status: response.status,
    code: error?.code ?? 'UNKNOWN',
    details: error?.details,
  };
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>('GET', path, undefined, signal),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
};
