export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/**
 * True when there was no response at all (0) or the server reports itself unavailable (503). The error screen
 * and query retries act on this. What may be sent again is a wider set: see `isTransient`.
 */
export function isUnavailable(err: unknown): err is ApiError {
  return err instanceof ApiError && (err.status === 0 || err.status === 503);
}

/** No response at all (0), or a gateway or unavailable answer while the host restarts the app. */
const TRANSIENT_STATUSES: ReadonlySet<unknown> = new Set([0, 502, 503, 504]);

/**
 * True for a failure that can pass on its own: no connection, or a server or gateway that is busy or
 * restarting. Sending the same request again later may work; after any other failure it will fail again.
 * The save queue retries on this, and a screen offers "Try again" on it.
 */
export function isTransient(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'status' in err && TRANSIENT_STATUSES.has(err.status);
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

/**
 * How long a request may go without a complete answer. A connection that has stalled reports nothing by
 * itself, and "Saving…" or "Checking…" would stay on screen for good. After this time the request is ended
 * and fails like one that could not be sent at all (status 0), so whatever retries or offers "Try again"
 * after a network failure does the same here.
 */
export const REQUEST_TIMEOUT_MS = 20_000;

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const url = apiUrl(path);
  const headers: Record<string, string> = { 'X-Requested-With': 'secplus' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  // A timer of our own rather than `AbortSignal.timeout`: it is stopped as soon as the answer is complete.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  let text: string;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    // The time covers the body too: an answer that begins and never ends is no answer.
    text = await res.text();
  } catch {
    throw new ApiError(0, "Can't reach the server");
  } finally {
    clearTimeout(timer);
  }

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
