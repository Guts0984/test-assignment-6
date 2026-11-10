import type { Message } from './bus';

/** Server-Sent Events framing. `data` is one JSON line, so it can never contain a raw newline. */
export const formatMessage = (m: Message): string =>
  `id: ${m.id}\nevent: ${m.type}\ndata: ${JSON.stringify({ data: m.data, origin: m.origin })}\n\n`;

/** An event without a history position (hello / resync): carries the current id so the client can continue. */
export const formatControl = (type: 'hello' | 'resync', currentId: string): string =>
  `id: ${currentId}\nevent: ${type}\ndata: {}\n\n`;

/** Comments are ignored by EventSource and keep proxies from closing an idle connection. */
export const formatPing = (): string => `: ping\n\n`;

export const formatRetry = (ms: number): string => `retry: ${ms}\n\n`;
