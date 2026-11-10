import { authDeps } from '@/server/modules/auth/http';
import { makeStreamHandler } from './handlers/stream';
import { getBus } from './singleton';

export { makeStreamHandler } from './handlers/stream';

/** Production wiring for `src/app/api/stream/route.ts`. */
export const streamHandler = makeStreamHandler({
  auth: authDeps,
  bus: getBus,
  heartbeatMs: 15_000,
});
