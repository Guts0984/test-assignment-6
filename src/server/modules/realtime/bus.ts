/**
 * In-process message bus with a bounded replay buffer.
 *
 * Ids look like `<epoch>:<seq>`. The epoch is random per server start, so a client that reconnects
 * after a restart (ids would collide with a different history) is told to resync instead of being
 * replayed unrelated messages.
 */
export type Message = {
  id: string;
  type: string;
  data: unknown;
  /** Client id of whoever caused this message (X-Client-Id header), so they can skip their own echo. */
  origin: string | null;
  /** The user who caused it. The client id is shown only to this user's own connections (see the stream). */
  originUser?: string | null;
};

export type Replay =
  | { kind: 'messages'; messages: Message[] }
  /** The client's position is unknown, too old or from another server run: it must refetch. */
  | { kind: 'resync' };

export type Bus = {
  publish: (
    type: string,
    data: unknown,
    origin: string | null,
    originUser?: string | null,
  ) => Message;
  subscribe: (listener: (message: Message) => void) => () => void;
  /** Messages after `lastEventId` (exclusive). `undefined` means a fresh connection: nothing to replay. */
  replay: (lastEventId: string | undefined) => Replay;
  latestId: () => string;
  subscriberCount: () => number;
};

type Options = { capacity?: number; epoch?: string };

export function createBus({ capacity = 1000, epoch = randomEpoch() }: Options = {}): Bus {
  let seq = 0;
  let buffer: Message[] = [];
  const listeners = new Set<(message: Message) => void>();
  const idOf = (n: number) => `${epoch}:${n}`;

  return {
    publish: (type, data, origin, originUser = null) => {
      seq += 1;
      const message: Message = { id: idOf(seq), type, data, origin, originUser };
      buffer = [...buffer.slice(-(capacity - 1)), message];
      // One failing listener must not stop delivery to the others.
      for (const listener of [...listeners]) {
        try {
          listener(message);
        } catch {
          /* a broken subscriber is its own problem */
        }
      }
      return message;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    replay: (lastEventId) => {
      if (lastEventId === undefined) return { kind: 'messages', messages: [] };
      const match = /^([^:]+):(\d+)$/.exec(lastEventId);
      if (!match || match[1] !== epoch) return { kind: 'resync' };
      const last = Number(match[2]);
      const oldest = seq - buffer.length + 1; // seq of buffer[0]
      if (last > seq || last < oldest - 1) return { kind: 'resync' };
      return { kind: 'messages', messages: buffer.filter((_, i) => oldest + i > last) };
    },
    latestId: () => idOf(seq),
    subscriberCount: () => listeners.size,
  };
}

function randomEpoch(): string {
  return Math.random().toString(36).slice(2, 10);
}
