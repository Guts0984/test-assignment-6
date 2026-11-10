import { renderHook, waitFor } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { api } from '@/shared/api/client';
import type { OccurrenceDto } from '@/shared/contracts';
import { mockRooms } from '@/shared/mocks/fixtures';
import { createMockServer } from '@/shared/mocks/server';
import { formatInstant, parseInstant } from '@/shared/zoned';
import { useFreeRooms } from './useFreeRooms';

// The same handlers Storybook uses answer here: Aurora is booked 10:00–11:00Z and Borealis 10:30–11:30Z
// on 2026-12-01 (src/shared/mocks/fixtures.ts).
const mock = createMockServer();
beforeAll(() => mock.start());
afterEach(() => mock.server.resetHandlers());
afterAll(() => mock.stop());

const at = (iso: string) => parseInstant(iso) as number;

async function fetchBusy(from: number, to: number, signal: AbortSignal): Promise<Set<string>> {
  const result = await api.get<{ occurrences: OccurrenceDto[] }>(
    `/api/events?from=${encodeURIComponent(formatInstant(from))}&to=${encodeURIComponent(formatInstant(to))}`,
    signal,
  );
  if (!result.ok) throw new Error(result.code);
  return new Set(result.data.occurrences.map((o) => o.roomId));
}

const hook = (slot: { start: number; end: number } | null, lookup: typeof fetchBusy = fetchBusy) =>
  renderHook(({ slot }) => useFreeRooms(slot, mockRooms, lookup, 0), {
    initialProps: { slot },
  });

describe('free-room suggestions against the mocked API', () => {
  it('offers only the rooms nobody booked for that time', async () => {
    const { result } = hook({ start: at('2026-12-01T10:00:00Z'), end: at('2026-12-01T11:00:00Z') });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    if (result.current.status !== 'ready') throw new Error('not ready');
    expect(result.current.free.map((r) => r.name)).toEqual(['Cosmos']);
    expect([...result.current.busyIds].sort()).toEqual(['room-a', 'room-b']);
  });

  it('a booking that merely touches the slot does not make the room busy (end is exclusive)', async () => {
    const { result } = hook({ start: at('2026-12-01T11:00:00Z'), end: at('2026-12-01T12:00:00Z') });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    if (result.current.status !== 'ready') throw new Error('not ready');
    // Aurora ends exactly at 11:00 (free again); Borealis runs until 11:30 (still busy).
    expect(result.current.free.map((r) => r.name)).toEqual(['Aurora', 'Cosmos']);
  });

  it('shows an error state when the server fails, instead of pretending everything is free', async () => {
    mock.server.use(http.get('*/api/events', () => HttpResponse.json({}, { status: 500 })));
    const { result } = hook({ start: at('2026-12-01T10:00:00Z'), end: at('2026-12-01T11:00:00Z') });
    await waitFor(() => expect(result.current.status).toBe('error'));
  });

  it('ignores a slow answer for an old slot that arrives after the answer for the new slot', async () => {
    const first = { start: at('2026-12-01T10:00:00Z'), end: at('2026-12-01T11:00:00Z') };
    const second = { start: at('2026-12-02T10:00:00Z'), end: at('2026-12-02T11:00:00Z') };
    let firstRequested = false;
    mock.server.use(
      http.get('*/api/events', async ({ request }) => {
        const from = new URL(request.url).searchParams.get('from') ?? '';
        if (from.startsWith('2026-12-01')) {
          firstRequested = true;
          await delay(150); // the old slot answers late: Aurora and Borealis busy
          return HttpResponse.json({
            occurrences: [
              { eventId: 'x', roomId: 'room-a', start: from, end: from },
              { eventId: 'y', roomId: 'room-b', start: from, end: from },
            ],
          });
        }
        return HttpResponse.json({ occurrences: [] }); // the new slot: everything free
      }),
    );
    // This lookup ignores the abort signal (a transport that cannot cancel): only the hook's own
    // "newer lookup wins" guard stands between the old answer and the screen.
    const { result, rerender } = hook(first, (from, to) =>
      fetchBusy(from, to, new AbortController().signal),
    );
    await waitFor(() => expect(firstRequested).toBe(true)); // the old lookup is really in flight
    rerender({ slot: second });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await delay(300); // let the stale answer arrive
    if (result.current.status !== 'ready') throw new Error('not ready');
    expect(result.current.free).toHaveLength(3);
  });
});
