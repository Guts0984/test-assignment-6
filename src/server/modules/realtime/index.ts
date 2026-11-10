/** Domain API of the realtime module (no web framework). The SSE route handler lives in `./http`. */
export { createBus, type Bus, type Message, type Replay } from './bus';
export { originOf, publishChange } from './publish';
export { getBus } from './singleton';
