/**
 * "The old answer must not overwrite the new one": for debounced async lookups (free rooms while the user
 * types a time). `run(fn)` starts a lookup and aborts the previous one; its result is delivered only if it
 * is still the latest by the time it settles. (Aborting alone is not enough: a response that has already
 * arrived cannot be aborted, and a fetch that ignores the signal would still resolve late.)
 */
export function createLatestOnly<T>() {
  let current = 0;
  let controller: AbortController | null = null;
  return {
    async run(
      fn: (signal: AbortSignal) => Promise<T>,
    ): Promise<{ stale: false; value: T } | { stale: true }> {
      const mine = ++current;
      controller?.abort();
      controller = new AbortController();
      try {
        const value = await fn(controller.signal);
        return mine === current ? { stale: false, value } : { stale: true };
      } catch (error) {
        if (mine !== current || (error as { name?: string }).name === 'AbortError')
          return { stale: true };
        throw error;
      }
    },
    cancel() {
      current += 1;
      controller?.abort();
    },
  };
}

/** Debounce: only the last call within `ms` runs. Returns a cancel function for cleanup. */
export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  ms: number,
  schedule: (run: () => void, ms: number) => () => void = defaultSchedule,
) {
  let cancel: (() => void) | null = null;
  const call = (...args: A) => {
    cancel?.();
    cancel = schedule(() => {
      cancel = null;
      fn(...args);
    }, ms);
  };
  call.cancel = () => cancel?.();
  return call;
}

const defaultSchedule = (run: () => void, ms: number) => {
  const id = setTimeout(run, ms);
  return () => clearTimeout(id);
};
