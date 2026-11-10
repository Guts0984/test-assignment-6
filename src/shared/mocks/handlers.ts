import { http, HttpResponse, type RequestHandler } from 'msw';
import type { OccurrenceDto } from '@/shared/contracts';
import { parseInstant } from '@/shared/zoned';
import { mockOccurrences, mockRooms, mockUsers } from './fixtures';

/**
 * The API as the browser sees it. The very same handlers serve the Vitest component tests (msw/node)
 * and Storybook (msw/browser through msw-storybook-addon), so a story and a test can never disagree
 * about what the server answers.
 */
export function apiHandlers(
  occurrences: readonly OccurrenceDto[] = mockOccurrences,
): RequestHandler[] {
  return [
    http.get('*/api/rooms', () => HttpResponse.json({ rooms: mockRooms })),
    http.get('*/api/users', () => HttpResponse.json({ users: mockUsers })),
    http.get('*/api/events', ({ request }) => {
      const url = new URL(request.url);
      const from = parseInstant(url.searchParams.get('from') ?? '');
      const to = parseInstant(url.searchParams.get('to') ?? '');
      if (from === null || to === null || to <= from) {
        return HttpResponse.json({ error: { code: 'VALIDATION' } }, { status: 400 });
      }
      return HttpResponse.json({
        occurrences: occurrences.filter((o) => {
          const [start, end] = [parseInstant(o.start), parseInstant(o.end)];
          return start !== null && end !== null && start < to && end > from;
        }),
      });
    }),
  ];
}
