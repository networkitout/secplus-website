import { ApiError } from '../../api/client';

/**
 * True for a failure that can pass on its own: no connection, or a server or gateway that is busy or
 * restarting. The save queue retries the same statuses. Any other failure will fail again if repeated.
 */
export function isTransient(err: unknown): boolean {
  return err instanceof ApiError && [0, 502, 503, 504].includes(err.status);
}
