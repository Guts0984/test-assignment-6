import { setupServer } from 'msw/node';
import { apiHandlers } from './handlers';

/**
 * The mocked API for Vitest: the very handlers Storybook uses. jsdom's fetch needs absolute URLs
 * while the app calls `/api/...`, so relative ones are resolved against a fake origin.
 */
export function createMockServer() {
  const server = setupServer(...apiHandlers());
  const realFetch = globalThis.fetch;
  const origin = 'http://localhost';
  return {
    server,
    start() {
      globalThis.fetch = (input, init) =>
        realFetch(
          typeof input === 'string' && input.startsWith('/') ? origin + input : input,
          init,
        );
      server.listen();
    },
    stop() {
      server.close();
      globalThis.fetch = realFetch;
    },
  };
}
