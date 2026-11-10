import { api, type ApiResult } from '@/shared/api/client';
import type { Blocker, EventDto, MutationResult } from '@/shared/contracts';
import type { Command, SendResult, Transport } from './types';

/** Turns an HTTP answer into what the sync engine understands. Pure, so it is tested on its own. */
export function toSendResult(result: ApiResult<MutationResult>): SendResult {
  if (result.ok) return { type: 'ok', result: result.data };
  if (result.kind === 'network') return { type: 'network' };
  switch (result.code) {
    case 'UNAUTHENTICATED':
      return { type: 'unauthenticated' };
    case 'VERSION_CONFLICT':
      return {
        type: 'version-conflict',
        current: ((result.details as { current?: EventDto } | undefined)?.current ??
          null) as EventDto | null,
      };
    case 'ROOM_CONFLICT':
      return {
        type: 'room-conflict',
        blockers: ((result.details as { blockers?: Blocker[] } | undefined)?.blockers ??
          []) as Blocker[],
      };
    case 'NOT_FOUND':
      return { type: 'not-found' };
    case 'VALIDATION':
      return { type: 'invalid', details: result.details };
    default:
      // A server error (5xx) is not the user's fault and may pass: treat like a network problem and retry.
      return result.status >= 500
        ? { type: 'network' }
        : { type: 'error', status: result.status, code: result.code };
  }
}

export const requestFor = (
  command: Command,
  version: number,
): { method: 'POST' | 'PATCH' | 'DELETE'; path: string; body?: unknown } => {
  switch (command.kind) {
    case 'create':
      return { method: 'POST', path: '/api/events', body: command.body };
    case 'update':
      return {
        method: 'PATCH',
        path: `/api/events/${command.eventId}`,
        body: { ...command.body, version },
      };
    case 'delete': {
      const query = new URLSearchParams({ version: String(version) });
      if (command.scope) query.set('scope', command.scope);
      if (command.occurrenceStart) query.set('occurrenceStart', command.occurrenceStart);
      return { method: 'DELETE', path: `/api/events/${command.eventId}?${query}` };
    }
  }
};

export const httpTransport: Transport = {
  send: async (command, version) => {
    const { method, path, body } = requestFor(command, version);
    const result =
      method === 'POST'
        ? await api.post<MutationResult>(path, body)
        : method === 'PATCH'
          ? await api.patch<MutationResult>(path, body)
          : await api.delete<MutationResult>(path);
    return toSendResult(result);
  },
};
