import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSaveQueue, guardUnload, type SaveState } from './saveQueue';

const netError = () => Object.assign(new Error('offline'), { status: 0 });
const badRequest = () => Object.assign(new Error('bad'), { status: 400 });
const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });

/** Saves whose outcome the test decides: `sent` lists the payloads in the order the server saw them. */
function controlled() {
  const sent: string[] = [];
  const outcome: Array<{ ok: () => void; fail: (err: unknown) => void }> = [];
  const save = (label: string) => () => {
    sent.push(label);
    return new Promise<void>((ok, fail) => outcome.push({ ok, fail }));
  };
  return { sent, outcome, save };
}

const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('saveQueue', () => {
  it('successful save: state saving -> idle', async () => {
    const q = createSaveQueue();
    const seen: SaveState[] = [];
    q.subscribe((s) => seen.push(s));
    const run = vi.fn().mockResolvedValue('ok');
    q.enqueue('a', run);
    expect(q.state()).toBe('saving');
    await q.flush();
    expect(run).toHaveBeenCalledTimes(1);
    expect(q.state()).toBe('idle');
    expect(seen).toEqual(['saving', 'idle']);
  });

  it('network failure: unsaved, retries after 1s, 3s, 10s, then every 10s, idle when a retry succeeds', async () => {
    const q = createSaveQueue();
    const run = vi
      .fn()
      .mockRejectedValueOnce(netError())
      .mockRejectedValueOnce(netError())
      .mockRejectedValueOnce(netError())
      .mockRejectedValueOnce(netError())
      .mockResolvedValue('ok');
    q.enqueue('a', run);
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    expect(q.state()).toBe('unsaved');

    await vi.advanceTimersByTimeAsync(999);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(2999);
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(9999);
    expect(run).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(4);
    expect(q.state()).toBe('unsaved');

    await vi.advanceTimersByTimeAsync(9999);
    expect(run).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(5);
    expect(q.state()).toBe('idle');
  });

  it.each([502, 503, 504])('%i is retried like a network failure, with the same backoff', async (status) => {
    const q = createSaveQueue();
    const run = vi
      .fn()
      .mockRejectedValueOnce(httpError(status))
      .mockRejectedValueOnce(httpError(status))
      .mockResolvedValue('ok');
    q.enqueue('a', run);
    await tick();
    expect(q.state()).toBe('unsaved');
    await tick(999);
    expect(run).toHaveBeenCalledTimes(1);
    await tick(1);
    expect(run).toHaveBeenCalledTimes(2);
    await tick(2999);
    expect(run).toHaveBeenCalledTimes(2);
    await tick(1);
    expect(run).toHaveBeenCalledTimes(3);
    expect(q.state()).toBe('idle');
  });

  it.each([401, 429, 500])('%i drops the item without a retry', async (status) => {
    const onError = vi.fn();
    const q = createSaveQueue(undefined, { onError });
    const err = httpError(status);
    const run = vi.fn().mockRejectedValue(err);
    q.enqueue('a', run);
    await tick(60_000);
    expect(run).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith('a', err);
    expect(q.state()).toBe('failed');
  });

  it('a second enqueue for the same key while the first is unsent sends only the latest payload', async () => {
    const sent: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const q = createSaveQueue(async (item) => {
      if (item.key === 'blocker') await gate;
      return item.run();
    });
    q.enqueue('blocker', async () => {});
    q.enqueue('a', async () => void sent.push('first'));
    q.enqueue('a', async () => void sent.push('second'));
    release();
    await q.flush();
    expect(sent).toEqual(['second']);
  });

  it('a newer save replaces an item that is waiting to retry', async () => {
    const q = createSaveQueue();
    const old = vi.fn().mockRejectedValue(netError());
    const fresh = vi.fn().mockResolvedValue('ok');
    q.enqueue('a', old);
    await vi.advanceTimersByTimeAsync(0);
    q.enqueue('a', fresh);
    await vi.advanceTimersByTimeAsync(1000);
    expect(old).toHaveBeenCalledTimes(1);
    expect(fresh).toHaveBeenCalledTimes(1);
    expect(q.state()).toBe('idle');
  });

  it('two different keys are both sent, in order', async () => {
    const events: string[] = [];
    let finishA!: () => void;
    const q = createSaveQueue();
    q.enqueue('a', async () => {
      events.push('a:start');
      await new Promise<void>((r) => (finishA = r));
      events.push('a:end');
    });
    q.enqueue('b', async () => {
      events.push('b:start');
      events.push('b:end');
    });
    await tick();
    expect(events).toEqual(['a:start']); // b waits for a: one save at a time
    finishA();
    await q.flush();
    expect(events).toEqual(['a:start', 'a:end', 'b:start', 'b:end']);
  });

  it('same key enqueued while in flight, in-flight send succeeds: both are sent, newest last', async () => {
    const { sent, outcome, save } = controlled();
    const q = createSaveQueue();
    const seen: SaveState[] = [];
    q.subscribe((s) => seen.push(s));
    q.enqueue('a', save('v1'));
    await tick();
    q.enqueue('a', save('v2'));
    await tick();
    expect(sent).toEqual(['v1']);

    outcome[0].ok();
    await tick();
    expect(sent).toEqual(['v1', 'v2']);
    expect(q.state()).toBe('saving');

    outcome[1].ok();
    await tick();
    expect(q.state()).toBe('idle');
    expect(seen).toEqual(['saving', 'idle']);
    await tick(60_000);
    expect(sent).toEqual(['v1', 'v2']);
  });

  it('same key enqueued while in flight, in-flight send fails: only the newest is sent on retry', async () => {
    const { sent, outcome, save } = controlled();
    const q = createSaveQueue();
    q.enqueue('a', save('v1'));
    await tick();
    q.enqueue('a', save('v2'));
    outcome[0].fail(netError());
    await tick();
    expect(q.state()).toBe('unsaved');

    await tick(999);
    expect(sent).toEqual(['v1']);
    await tick(1);
    expect(sent).toEqual(['v1', 'v2']);

    outcome[1].ok();
    await tick(60_000);
    expect(sent).toEqual(['v1', 'v2']);
    expect(q.state()).toBe('idle');
  });

  it('v1 in flight, v2 enqueued, v1 fails, v3 enqueued during the wait: v3 is sent last and v2 never', async () => {
    const { sent, outcome, save } = controlled();
    const q = createSaveQueue();
    q.enqueue('a', save('v1'));
    await tick();
    q.enqueue('a', save('v2'));
    outcome[0].fail(netError());
    await tick(500);
    q.enqueue('a', save('v3'));
    await tick(500);
    expect(sent).toEqual(['v1', 'v3']);

    outcome[1].ok();
    await tick(60_000);
    expect(sent).toEqual(['v1', 'v3']);
    expect(q.state()).toBe('idle');
  });

  it('a newer payload enqueued while a retry is in flight replaces it if that retry fails too', async () => {
    const { sent, outcome, save } = controlled();
    const q = createSaveQueue();
    q.enqueue('a', save('v1'));
    await tick();
    outcome[0].fail(netError());
    await tick(1000);
    expect(sent).toEqual(['v1', 'v1']);
    q.enqueue('a', save('v2'));
    q.enqueue('a', save('v3'));
    outcome[1].fail(netError());
    await tick(2999);
    expect(sent).toEqual(['v1', 'v1']);
    await tick(1);
    expect(sent).toEqual(['v1', 'v1', 'v3']);

    outcome[2].ok();
    await tick(60_000);
    expect(sent).toEqual(['v1', 'v1', 'v3']);
    expect(q.state()).toBe('idle');
  });

  it('another key is not sent while the first key waits to retry', async () => {
    const { sent, outcome, save } = controlled();
    const q = createSaveQueue();
    q.enqueue('a', save('a1'));
    await tick();
    q.enqueue('b', save('b1'));
    outcome[0].fail(netError());
    await tick(999);
    expect(sent).toEqual(['a1']);
    expect(q.state()).toBe('unsaved');

    await tick(1);
    expect(sent).toEqual(['a1', 'a1']);
    outcome[1].ok();
    await tick();
    expect(sent).toEqual(['a1', 'a1', 'b1']);
    outcome[2].ok();
    await tick();
    expect(q.state()).toBe('idle');
  });

  it('a failed key keeps its place ahead of other keys and retries with its newest payload', async () => {
    const { sent, outcome, save } = controlled();
    const q = createSaveQueue();
    q.enqueue('a', save('a1'));
    await tick();
    q.enqueue('b', save('b1'));
    q.enqueue('a', save('a2'));
    outcome[0].fail(netError());
    await tick(1000);
    expect(sent).toEqual(['a1', 'a2']);
    outcome[1].ok();
    await tick();
    expect(sent).toEqual(['a1', 'a2', 'b1']);
    outcome[2].ok();
    await tick(60_000);
    expect(sent).toEqual(['a1', 'a2', 'b1']);
    expect(q.state()).toBe('idle');
  });

  it('a dropped key does not hold back other keys or its own newer payload', async () => {
    const { sent, outcome, save } = controlled();
    const q = createSaveQueue();
    q.enqueue('a', save('a1'));
    await tick();
    q.enqueue('b', save('b1'));
    q.enqueue('a', save('a2'));
    outcome[0].fail(badRequest());
    await tick();
    expect(sent).toEqual(['a1', 'b1']);
    outcome[1].ok();
    await tick();
    expect(sent).toEqual(['a1', 'b1', 'a2']);
    outcome[2].ok();
    await tick();
    expect(q.state()).toBe('idle');
  });

  it('a 400 response drops the item, does not retry, and reports it', async () => {
    const onError = vi.fn();
    const q = createSaveQueue(undefined, { onError });
    const seen: SaveState[] = [];
    q.subscribe((s) => seen.push(s));
    const err = badRequest();
    const run = vi.fn().mockRejectedValue(err);
    q.enqueue('a', run);
    await tick(60_000);
    expect(run).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith('a', err);
    expect(q.state()).toBe('failed');
    expect(seen).toEqual(['saving', 'failed']);
  });

  it('flush resolves once nothing is left to send, also after a drop', async () => {
    const q = createSaveQueue();
    q.enqueue('a', vi.fn().mockRejectedValue(badRequest()));
    await expect(q.flush()).resolves.toBeUndefined();
    expect(q.state()).toBe('failed');
    await expect(q.flush()).resolves.toBeUndefined();
  });

  it('a drop is still reported after a save queued behind it for another key succeeds', async () => {
    const { sent, outcome, save } = controlled();
    const q = createSaveQueue();
    const seen: SaveState[] = [];
    q.subscribe((s) => seen.push(s));
    q.enqueue('a', save('a1'));
    q.enqueue('b', save('b1'));
    await tick();
    outcome[0].fail(badRequest());
    await tick();
    expect(q.state()).toBe('saving');
    outcome[1].ok();
    await tick();
    expect(sent).toEqual(['a1', 'b1']);
    expect(q.state()).toBe('failed');
    expect(seen).toEqual(['saving', 'failed']);
  });

  it('a drop is still reported after a later save for another key succeeds', async () => {
    const q = createSaveQueue();
    q.enqueue('a', vi.fn().mockRejectedValue(badRequest()));
    await q.flush();
    q.enqueue('b', vi.fn().mockResolvedValue('ok'));
    expect(q.state()).toBe('saving');
    await q.flush();
    expect(q.state()).toBe('failed');
  });

  it('with two keys dropped, failed lasts until both have been saved again', async () => {
    const q = createSaveQueue();
    q.enqueue('a', vi.fn().mockRejectedValue(badRequest()));
    q.enqueue('b', vi.fn().mockRejectedValue(badRequest()));
    await q.flush();
    expect(q.state()).toBe('failed');

    q.enqueue('a', vi.fn().mockResolvedValue('ok'));
    await q.flush();
    expect(q.state()).toBe('failed');

    q.enqueue('b', vi.fn().mockResolvedValue('ok'));
    await q.flush();
    expect(q.state()).toBe('idle');
  });

  it('failed is left when a later save for the dropped key succeeds', async () => {
    const q = createSaveQueue();
    const seen: SaveState[] = [];
    q.subscribe((s) => seen.push(s));
    q.enqueue('a', vi.fn().mockRejectedValue(badRequest()));
    await q.flush();
    q.enqueue('a', vi.fn().mockResolvedValue('ok'));
    expect(q.state()).toBe('saving');
    await q.flush();
    expect(q.state()).toBe('idle');
    expect(seen).toEqual(['saving', 'failed', 'saving', 'idle']);
  });

  it('failed is left when dismissed, and subscribers are told', async () => {
    const q = createSaveQueue();
    q.enqueue('a', vi.fn().mockRejectedValue(badRequest()));
    q.enqueue('b', vi.fn().mockRejectedValue(badRequest()));
    await q.flush();
    const seen: SaveState[] = [];
    q.subscribe((s) => seen.push(s));
    q.dismiss();
    expect(q.state()).toBe('idle');
    expect(seen).toEqual(['idle']);

    // Dismissed drops stay dismissed: a later save for another key does not bring the message back.
    q.enqueue('c', vi.fn().mockResolvedValue('ok'));
    await q.flush();
    expect(q.state()).toBe('idle');
  });

  it('saving and unsaved take priority over failed while work is in progress', async () => {
    const { outcome, save } = controlled();
    const q = createSaveQueue();
    q.enqueue('a', save('a1'));
    q.enqueue('b', save('b1'));
    await tick();
    outcome[0].fail(badRequest());
    await tick();
    expect(q.state()).toBe('saving');
    outcome[1].fail(netError());
    await tick();
    expect(q.state()).toBe('unsaved');
    await tick(1000);
    outcome[2].fail(badRequest());
    await tick();
    expect(q.state()).toBe('failed');
  });

  it('an item that failed then succeeded is sent exactly once successfully (no duplicate after success)', async () => {
    const q = createSaveQueue();
    const run = vi.fn().mockRejectedValueOnce(netError()).mockResolvedValue('ok');
    q.enqueue('a', run);
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('beforeunload warns only while not idle', async () => {
    const q = createSaveQueue();
    const stop = guardUnload(q);
    const idle = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(idle);
    expect(idle.defaultPrevented).toBe(false);

    q.enqueue('a', vi.fn().mockRejectedValue(netError()));
    await vi.advanceTimersByTimeAsync(0);
    const busy = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(busy);
    expect(busy.defaultPrevented).toBe(true);
    stop();
  });

  it('beforeunload does not warn once a save was dropped and nothing is left to send', async () => {
    const q = createSaveQueue();
    const stop = guardUnload(q);
    q.enqueue('a', vi.fn().mockRejectedValue(badRequest()));
    await q.flush();
    const failed = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(failed);
    expect(failed.defaultPrevented).toBe(false);
    stop();
  });
});
