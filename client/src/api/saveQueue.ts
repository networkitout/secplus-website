export type SaveState = 'idle' | 'saving' | 'unsaved';

export interface SaveItem {
  key: string;
  run: () => Promise<unknown>;
}

export interface SaveQueue {
  enqueue(key: string, run: () => Promise<unknown>): void;
  state(): SaveState;
  subscribe(fn: (s: SaveState) => void): () => void;
  flush(): Promise<void>;
}

export interface SaveQueueOptions {
  /** Retry delays after the 1st, 2nd, ... failure; the last one repeats. Default [1000, 3000, 10000]. */
  delaysMs?: number[];
  /** Called when an item is dropped because of a non-retryable error. */
  onError?: (key: string, error: unknown) => void;
}

const retryable = (err: unknown) =>
  typeof err === 'object' && err !== null && 'status' in err && ((err as { status: unknown }).status === 0 || (err as { status: unknown }).status === 503);

/**
 * Saves one item at a time, in order. A newer save for a key replaces an unsent older one.
 * Network failures (status 0 / 503) are retried until they succeed; other errors drop the item.
 */
export function createSaveQueue(
  send: (item: SaveItem) => Promise<unknown> = (item) => item.run(),
  opts: SaveQueueOptions = {},
): SaveQueue {
  const delays = opts.delaysMs && opts.delaysMs.length ? opts.delaysMs : [1000, 3000, 10000];
  const pending = new Map<string, () => Promise<unknown>>();
  let current: { key: string; run: () => Promise<unknown>; failures: number; sending: boolean } | null = null;
  let running = false;
  let last: SaveState = 'idle';
  const listeners = new Set<(s: SaveState) => void>();
  let waiters: Array<() => void> = [];

  const compute = (): SaveState => {
    if (!current && pending.size === 0) return 'idle';
    return current && current.failures > 0 ? 'unsaved' : 'saving';
  };

  const notify = () => {
    const s = compute();
    if (s !== last) {
      last = s;
      for (const fn of [...listeners]) fn(s);
    }
    if (s === 'idle') {
      const w = waiters;
      waiters = [];
      for (const resolve of w) resolve();
    }
  };

  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  async function pump() {
    if (running) return;
    running = true;
    try {
      for (;;) {
        if (!current) {
          const first = pending.entries().next();
          if (first.done) break;
          const [key, run] = first.value;
          pending.delete(key);
          current = { key, run, failures: 0, sending: false };
        }
        const item = current;
        item.sending = true;
        try {
          await send({ key: item.key, run: item.run });
          current = null;
        } catch (err) {
          item.sending = false;
          if (retryable(err)) {
            item.failures += 1;
            notify();
            await sleep(delays[Math.min(item.failures - 1, delays.length - 1)]);
            continue;
          }
          current = null;
          opts.onError?.(item.key, err);
        }
        notify();
      }
    } finally {
      running = false;
      notify();
    }
  }

  return {
    enqueue(key, run) {
      if (current && current.key === key && !current.sending) current.run = run; // unsent (waiting to retry)
      else pending.set(key, run);
      notify();
      void pump();
    },
    state: () => compute(),
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    flush() {
      if (compute() === 'idle') return Promise.resolve();
      return new Promise<void>((resolve) => waiters.push(resolve));
    },
  };
}

/** Warns before the page unloads while there is unsaved work. Returns a function that removes the guard. */
export function guardUnload(queue: SaveQueue): () => void {
  const handler = (e: BeforeUnloadEvent) => {
    if (queue.state() === 'idle') return;
    e.preventDefault();
    e.returnValue = '';
  };
  window.addEventListener('beforeunload', handler);
  return () => window.removeEventListener('beforeunload', handler);
}

/** The app-wide queue used by feature screens. */
export const saveQueue = createSaveQueue(undefined, {
  onError: (key, error) => console.warn(`Save "${key}" was rejected and dropped`, error),
});
if (typeof window !== 'undefined') guardUnload(saveQueue);
