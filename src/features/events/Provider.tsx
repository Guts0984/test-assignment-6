'use client';

import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { createIdbStorage, createStream, httpTransport, type SyncState } from '@/features/sync';
import { getClientId } from '@/shared/api/client';
import { registerServiceWorker } from '@/shared/register-sw';
import type { PublicUser } from '@/shared/contracts';
import { createEventsRuntime, type EventsRuntime, type Notifier } from './runtime';
import { keys } from './queries';
import type { History } from './history';

const RuntimeContext = createContext<EventsRuntime | null>(null);

/** The runtime, or null while rendering on the server (it needs IndexedDB and the network). */
export const useRuntime = (): EventsRuntime | null => useContext(RuntimeContext);

const SERVER_SYNC_STATE: SyncState = {
  status: 'saved',
  pending: 0,
  conflict: null,
  storageFailed: false,
};

export function useSyncState(): SyncState {
  const runtime = useRuntime();
  return useSyncExternalStore(
    (listener) => runtime?.engine.subscribe(listener) ?? (() => {}),
    () => runtime?.engine.getState() ?? SERVER_SYNC_STATE,
    () => SERVER_SYNC_STATE,
  );
}

const EMPTY_HISTORY: History = { past: [], future: [] };
export function useHistoryState(): { canUndo: boolean; canRedo: boolean } {
  const runtime = useRuntime();
  const history = useSyncExternalStore(
    (listener) => runtime?.history.subscribe(listener) ?? (() => {}),
    () => runtime?.history.get() ?? EMPTY_HISTORY,
    () => EMPTY_HISTORY,
  );
  return { canUndo: history.past.length > 0, canRedo: history.future.length > 0 };
}

const isTyping = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

type Props = {
  user: PublicUser;
  userName: (id: string) => string;
  notifier: Notifier;
  children: ReactNode;
};

export function EventsProvider({ user, userName, notifier, children }: Props) {
  const client = useQueryClient();
  // Created once on the client. Creating it has no side effects: nothing starts until the effect below.
  const [runtime] = useState<EventsRuntime | null>(() =>
    typeof window === 'undefined'
      ? null
      : createEventsRuntime({
          client,
          storage: createIdbStorage(user.id),
          transport: httpTransport,
          me: { id: user.id, name: user.name },
          userName,
          notifier,
        }),
  );

  useEffect(() => {
    if (!runtime) return;
    let cancelled = false;
    registerServiceWorker();
    // Queued changes from a previous visit: load them, draw them over whatever is on screen, send them.
    runtime.engine.setOnline(navigator.onLine);
    void runtime.engine.start().then(() => !cancelled && runtime.restoreFromQueue());

    const goOnline = () => runtime.engine.setOnline(true);
    const goOffline = () => runtime.engine.setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    // Some browsers (Firefox after a reload while offline) never fire "online". Re-read the flag
    // while the engine believes it is offline, so the queue cannot stay stuck forever.
    const recheck = setInterval(() => {
      if (navigator.onLine && runtime.engine.getState().status === 'offline') goOnline();
    }, 2000);

    const stream = createStream(
      { url: '/api/stream', clientId: getClientId() },
      {
        onChanged: (message) => runtime.applyRemote(message),
        onRefetch: () =>
          void client.invalidateQueries({ queryKey: keys.periods, refetchType: 'active' }),
      },
    );

    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z' || isTyping(e.target)) return;
      e.preventDefault();
      if (e.shiftKey) runtime.actions.redo();
      else runtime.actions.undo();
    };
    window.addEventListener('keydown', onKey);

    return () => {
      cancelled = true;
      clearInterval(recheck);
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('keydown', onKey);
      stream.close();
    };
  }, [runtime, client]);

  return <RuntimeContext.Provider value={runtime}>{children}</RuntimeContext.Provider>;
}
