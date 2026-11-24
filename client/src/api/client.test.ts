import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, isTransient, isUnavailable, REQUEST_TIMEOUT_MS, setUnauthorizedHandler } from './client';
import { createSaveQueue } from './saveQueue';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setUnauthorizedHandler(null);
});

describe('api client', () => {
  it('adds X-Requested-With on every request', async () => {
    fetchMock.mockImplementation(async () => json(200, {}));
    await api.get('dashboard');
    await api.post('answers', { a: 1 });
    await api.put('settings', {});
    await api.patch('admin/users/1', {});
    expect(fetchMock).toHaveBeenCalledTimes(4);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init.headers['X-Requested-With']).toBe('secplus');
      expect(init.credentials).toBe('same-origin');
    }
    expect(fetchMock.mock.calls[1][0]).toBe('/api/answers');
    expect(fetchMock.mock.calls[1][1].body).toBe('{"a":1}');
  });

  it('401 from /api/dashboard navigates to /login?next=%2Fdashboard; 401 from /api/auth/me does not', async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    window.history.pushState({}, '', '/dashboard');
    fetchMock.mockImplementation(async () => json(401, { error: 'Not signed in' }));

    await expect(api.get('/api/dashboard')).rejects.toMatchObject({ status: 401 });
    expect(handler).toHaveBeenCalledWith('/login?next=%2Fdashboard');

    handler.mockClear();
    await expect(api.get('auth/me')).rejects.toMatchObject({ status: 401 });
    expect(handler).not.toHaveBeenCalled();
  });

  it('non-2xx throws ApiError with the server message', async () => {
    fetchMock.mockResolvedValue(json(400, { error: 'Bad input' }));
    const err = await api.post('x', {}).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 400, message: 'Bad input' });
  });

  it('a network failure throws ApiError status 0 and a 503 throws status 503', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(api.get('path')).rejects.toMatchObject({ name: 'ApiError', status: 0 });
    fetchMock.mockResolvedValueOnce(new Response('<html>down</html>', { status: 503 }));
    await expect(api.get('path')).rejects.toMatchObject({ status: 503 });
  });
});

describe('a request without an answer', () => {
  /** Rejects when the request is aborted, as the browser does; until then nothing happens. */
  const untilAborted = (signal: AbortSignal) =>
    new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError'))));
  /** A connection that has stalled: no answer and no error. */
  const stalled = (_url: string, init: RequestInit) => untilAborted(init.signal!);
  const signalOf = (call: number): AbortSignal => fetchMock.mock.calls[call]![1].signal;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('is given up after 20 seconds, as the network failure it is: status 0, which the retry paths act on', async () => {
    expect(REQUEST_TIMEOUT_MS).toBe(20_000);
    fetchMock.mockImplementation(stalled);
    const outcome = api.post('answers', { a: 1 }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS - 1);
    expect(signalOf(0).aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(signalOf(0).aborted).toBe(true);
    const err = await outcome;
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 0, message: "Can't reach the server" });
    expect(isTransient(err)).toBe(true);
    expect(isUnavailable(err)).toBe(true);
  });

  it('is given up in the same way when the answer has begun and its body never ends', async () => {
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => ({ ok: true, status: 200, text: () => untilAborted(init.signal!) }));
    const outcome = api.get('dashboard').catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    expect(await outcome).toMatchObject({ name: 'ApiError', status: 0 });
  });

  it('an answer in time stops the clock: nothing is aborted afterwards, and no timer is left running', async () => {
    fetchMock.mockImplementation(async () => json(200, { ok: true }));
    await expect(api.get('dashboard')).resolves.toEqual({ ok: true });
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS * 3);
    expect(signalOf(0).aborted).toBe(false);

    // A refused request stops it too.
    fetchMock.mockImplementation(async () => json(400, { error: 'Bad input' }));
    await expect(api.post('x', {})).rejects.toMatchObject({ status: 400 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a save that got no answer is sent again by the save queue, like one that could not be sent at all', async () => {
    fetchMock.mockImplementationOnce(stalled).mockImplementation(async () => json(200, {}));
    const dropped = vi.fn();
    const queue = createSaveQueue(undefined, { delaysMs: [1000], onError: dropped });
    queue.enqueue('q1', () => api.put('assessments/30/answers', { questionId: 'q1' }));
    expect(queue.state()).toBe('saving');

    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    expect(queue.state()).toBe('unsaved');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(queue.state()).toBe('idle');
    expect(dropped).not.toHaveBeenCalled();
  });
});

describe('isTransient', () => {
  it.each([0, 502, 503, 504])('is true for %i: the same request may work later', (status) => {
    expect(isTransient(new ApiError(status, 'failed'))).toBe(true);
    // Anything that carries the status counts: the save queue is handed errors of other kinds too.
    expect(isTransient({ status })).toBe(true);
  });

  it.each([400, 401, 403, 404, 409, 429, 500])('is false for %i: the same request would fail again', (status) => {
    expect(isTransient(new ApiError(status, 'failed'))).toBe(false);
  });

  it('is false for what is not a failed request, and is a wider set than "the server is unavailable"', () => {
    for (const other of [new TypeError('boom'), 'offline', null, undefined, { status: '503' }]) expect(isTransient(other)).toBe(false);
    expect(isUnavailable(new ApiError(502, 'Bad gateway'))).toBe(false);
    expect(isUnavailable(new ApiError(503, 'Service unavailable'))).toBe(true);
  });
});
