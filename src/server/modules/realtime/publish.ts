import { getBus } from './singleton';

/** Announces a change to every connected client. `origin` is the author's X-Client-Id, if any. */
export const publishChange = (
  type: string,
  data: unknown,
  origin: string | null,
  originUser: string | null = null,
): void => {
  getBus().publish(type, data, origin, originUser);
};

/** Reads and sanitizes the X-Client-Id request header. */
export const originOf = (headers: Headers): string | null => {
  const raw = headers.get('x-client-id');
  return raw && /^[A-Za-z0-9_-]{1,64}$/.test(raw) ? raw : null;
};
