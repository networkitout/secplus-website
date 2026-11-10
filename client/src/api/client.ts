export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** True for failures worth retrying: no response at all (0) or the server is unavailable (503). */
export function isUnavailable(err: unknown): err is ApiError {
  return err instanceof ApiError && (err.status === 0 || err.status === 503);
}

const defaultUnauthorized = (loginUrl: string) => window.location.assign(loginUrl);
let onUnauthorized: (loginUrl: string) => void = defaultUnauthorized;

/** Lets the router-aware auth provider turn a 401 into an in-app navigation. */
export function setUnauthorizedHandler(handler: ((loginUrl: string) => void) | null): void {
  onUnauthorized = handler ?? defaultUnauthorized;
}

function apiUrl(path: string): string {
  const p = path.replace(/^\/+/, '');
  return p.startsWith('api/') ? `/${p}` : `/api/${p}`;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const url = apiUrl(path);
  const headers: Record<string, string> = { 'X-Requested-With': 'secplus' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "Can't reach the server");
  }

  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = undefined;
  }

  if (!res.ok) {
    const message =
      (data as { error?: unknown } | undefined)?.error && typeof (data as { error: unknown }).error === 'string'
        ? (data as { error: string }).error
        : `Request failed (${res.status})`;
    if (res.status === 401 && !url.startsWith('/api/auth/') && window.location.pathname !== '/login') {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      onUnauthorized(`/login?next=${next}`);
    }
    throw new ApiError(res.status, message);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
};
