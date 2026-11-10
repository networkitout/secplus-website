import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, isTransient, isUnavailable, setUnauthorizedHandler } from './client';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
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
