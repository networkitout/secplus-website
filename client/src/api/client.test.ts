import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, setUnauthorizedHandler } from './client';

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
