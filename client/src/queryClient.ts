import { QueryClient } from '@tanstack/react-query';
import { isUnavailable } from './api/client';

/**
 * Network/503 failures reach the top-level error boundary when a screen has nothing to show yet.
 * A failed background refetch keeps the data already on screen; other errors stay with the query.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: (count, err) => isUnavailable(err) && count < 1,
        throwOnError: (err, query) => isUnavailable(err) && query.state.data === undefined,
        refetchOnWindowFocus: false,
      },
    },
  });
}
