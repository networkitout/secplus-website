import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSaveQueue, guardUnload, type SaveState } from './saveQueue';

const netError = () => Object.assign(new Error('offline'), { status: 0 });

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

  it('503 is retried like a network failure', async () => {
    const q = createSaveQueue();
    const run = vi.fn().mockRejectedValueOnce(Object.assign(new Error('down'), { status: 503 })).mockResolvedValue('ok');
    q.enqueue('a', run);
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(2);
    expect(q.state()).toBe('idle');
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
    const sent: string[] = [];
    const q = createSaveQueue();
    q.enqueue('a', async () => void sent.push('a'));
    q.enqueue('b', async () => void sent.push('b'));
    await q.flush();
    expect(sent).toEqual(['a', 'b']);
  });

  it('a 400 response drops the item, does not retry, and reports it', async () => {
    const onError = vi.fn();
    const q = createSaveQueue(undefined, { onError });
    const err = Object.assign(new Error('bad'), { status: 400 });
    const run = vi.fn().mockRejectedValue(err);
    q.enqueue('a', run);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith('a', err);
    expect(q.state()).toBe('idle');
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
});
