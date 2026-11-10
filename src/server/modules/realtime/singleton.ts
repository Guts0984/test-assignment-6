import { createBus, type Bus } from './bus';

// One bus per server process, shared by route bundles and surviving dev hot reloads.
const globalForBus = globalThis as unknown as { __bus?: Bus };

export const getBus = (): Bus => (globalForBus.__bus ??= createBus());
