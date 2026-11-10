export type SaveState = 'idle' | 'saving' | 'unsaved' | 'failed';

type Run = () => Promise<unknown>;

export interface SaveItem {
  key: string;
  run: Run;
}

export interface SaveQueue {
  enqueue(key: string, run: Run): void;
  state(): SaveState;
  subscribe(fn: (s: SaveState) => void): () => void;
  /** Resolves once nothing is left to send (every item has been saved or dropped). */
  flush(): Promise<void>;
  /** Leaves the `failed` state, once the learner has been told that a save was dropped. */
  dismiss(): void;
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
 * Saves one item at a time, in the order the keys were enqueued.
 *
 * - Per key there is at most one payload that has not been handed to `send` yet, and it is the newest one.
 * - Network failures (status 0 / 503) are retried until they succeed. The failed key keeps its place at the
 *   front, so no other key is sent before it, and a retry always sends the newest payload for that key:
 *   a payload that failed and was superseded is never sent again.
 * - Any other error drops the item, reports it through `onError` and puts the queue in `failed` until a later
 *   save succeeds or `dismiss()` is called. `saving` / `unsaved` take priority while there is work left.
 */
export function createSaveQueue(
  send: (item: SaveItem) => Promise<unknown> = (item) => item.run(),
  opts: SaveQueueOptions = {},
): SaveQueue {
  const delays = opts.delaysMs && opts.delaysMs.length ? opts.delaysMs : [1000, 3000, 10000];
  // Payloads not handed to `send` yet, in send order. A newer payload for a key replaces the older one in place.
  const waiting = new Map<string, Run>();
  // The save at the front: in flight, or (after a retryable failure) waiting for its retry timer.
  let head: { key: string; run: Run; failures: number; inFlight: boolean } | null = null;
  let dropped = false;
  let pumping = false;
  let last: SaveState = 'idle';
  const listeners = new Set<(s: SaveState) => void>();
  let waiters: Array<() => void> = [];

  const busy = () => head !== null || waiting.size > 0;

  const compute = (): SaveState => {
    if (!busy()) return dropped ? 'failed' : 'idle';
    return head && head.failures > 0 ? 'unsaved' : 'saving';
  };

  const notify = () => {
    const s = compute();
    if (s !== last) {
      last = s;
      for (const fn of [...listeners]) fn(s);
    }
    if (!busy()) {
      const w = waiters;
      waiters = [];
      for (const resolve of w) resolve();
    }
  };

  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  async function pump() {
    if (pumping) return;
    pumping = true;
    try {
      for (;;) {
        if (!head) {
          const first = waiting.entries().next();
          if (first.done) break;
          const [key, run] = first.value;
          waiting.delete(key);
          head = { key, run, failures: 0, inFlight: false };
        }
        const item = head;
        item.inFlight = true;
        try {
          await send({ key: item.key, run: item.run });
          head = null;
          dropped = false;
        } catch (err) {
          item.inFlight = false;
          if (retryable(err)) {
            item.failures += 1;
            // A payload enqueued for this key during the failed attempt supersedes the one that failed.
            const newer = waiting.get(item.key);
            if (newer) {
              waiting.delete(item.key);
              item.run = newer;
            }
            notify();
            await sleep(delays[Math.min(item.failures - 1, delays.length - 1)]);
            continue;
          }
          head = null;
          dropped = true;
          opts.onError?.(item.key, err);
        }
        notify();
      }
    } finally {
      pumping = false;
      notify();
    }
  }

  return {
    enqueue(key, run) {
      // While the front item waits for its retry timer it has not been sent, so a newer payload replaces it there.
      if (head && head.key === key && !head.inFlight) head.run = run;
      else waiting.set(key, run);
      notify();
      void pump();
    },
    state: () => compute(),
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    flush() {
      if (!busy()) return Promise.resolve();
      return new Promise<void>((resolve) => waiters.push(resolve));
    },
    dismiss() {
      dropped = false;
      notify();
    },
  };
}

/** Warns before the page unloads while a save is still on its way. Returns a function that removes the guard. */
export function guardUnload(queue: SaveQueue): () => void {
  const handler = (e: BeforeUnloadEvent) => {
    const state = queue.state();
    if (state === 'idle' || state === 'failed') return;
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
