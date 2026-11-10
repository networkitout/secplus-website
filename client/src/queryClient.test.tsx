import { render, screen } from '@testing-library/react';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from './api/client';
import { createQueryClient } from './queryClient';
import { ErrorBoundary } from './ui/ErrorBoundary';

function Stats({ load }: { load: () => Promise<string> }) {
  const q = useQuery({ queryKey: ['stats'], queryFn: load });
  return (
    <p>
      {q.data ?? 'loading'}
      {q.isRefetchError && ' (could not refresh)'}
    </p>
  );
}

function renderStats(load: () => Promise<string>) {
  const client = createQueryClient();
  client.setDefaultOptions({ queries: { ...client.getDefaultOptions().queries, retry: false } }); // no 1 s retry wait
  render(
    <QueryClientProvider client={client}>
      <ErrorBoundary>
        <Stats load={load} />
      </ErrorBoundary>
    </QueryClientProvider>,
    { onCaughtError: () => {} },
  );
  return client;
}

describe('query client', () => {
  it('a network failure on the first load reaches the error boundary', async () => {
    renderStats(vi.fn().mockRejectedValue(new ApiError(0, 'offline')));
    expect(await screen.findByRole('heading', { name: "Can't reach the server" })).toBeInTheDocument();
  });

  it('a network failure on a background refetch keeps the screen that already has data', async () => {
    const load = vi.fn().mockResolvedValueOnce('120 XP').mockRejectedValue(new ApiError(0, 'offline'));
    const client = renderStats(load);
    expect(await screen.findByText('120 XP')).toBeInTheDocument();

    void client.refetchQueries();
    expect(await screen.findByText('120 XP (could not refresh)')).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('heading', { name: "Can't reach the server" })).not.toBeInTheDocument();
  });
});
