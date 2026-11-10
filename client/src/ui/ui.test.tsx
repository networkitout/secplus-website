import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import { createSaveQueue } from '../api/saveQueue';
import type { User } from '../api/types';
import { AuthContext } from '../features/auth/AuthProvider';
import { RewardsProvider, useRewards } from '../features/rewards/RewardsProvider';
import { createQueryClient } from '../queryClient';
import { AppShell } from './AppShell';
import { Celebration } from './Celebration';
import { ErrorBoundary } from './ErrorBoundary';
import { MasteryBar } from './MasteryBar';
import { ProgressRing } from './ProgressRing';
import { SaveIndicator } from './SaveIndicator';
import { ThemeToggle } from './ThemeToggle';

const user = (role: User['role']): User => ({
  id: 1, login: 'sam', name: 'Sam', role, timeZone: 'UTC', examDate: null, hideFromLeaderboard: false,
});

const FOOTER = 'Not affiliated with or endorsed by CompTIA. Security+ is a trademark of CompTIA, Inc.';

const STATS = { xp: 120, level: 3, nextLevelXp: 200, streak: 4 };

function renderShell(
  role: User['role'],
  logout: () => Promise<void> = vi.fn(),
  page: ReactNode = <p>page body</p>,
  stats: () => typeof STATS = () => STATS,
) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(stats()), { status: 200 })));
  const auth = { user: user(role), loading: false, login: vi.fn(), logout, refresh: vi.fn() };
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <AuthContext.Provider value={auth}>
        <RewardsProvider>
          <MemoryRouter><AppShell>{page}</AppShell></MemoryRouter>
        </RewardsProvider>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('ui', () => {
  it('ProgressRing exposes role="progressbar" with aria-valuenow', () => {
    render(<ProgressRing value={42} label="Domain 1" />);
    const bar = screen.getByRole('progressbar', { name: 'Domain 1' });
    expect(bar).toHaveAttribute('aria-valuenow', '42');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
  });

  it('MasteryBar exposes progressbar semantics and shows the number', () => {
    render(<MasteryBar value={73} label="Mastery" />);
    expect(screen.getByRole('progressbar', { name: 'Mastery' })).toHaveAttribute('aria-valuenow', '73');
    expect(screen.getByText('73%')).toBeInTheDocument();
  });

  it('AppShell shows Admin link only for admins and always shows the CompTIA footer', async () => {
    const learner = renderShell('learner');
    expect(await screen.findByText(/Level 3/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Admin' })).not.toBeInTheDocument();
    expect(screen.getByText(FOOTER)).toBeInTheDocument();
    for (const name of ['Path', 'Review', 'Labs', 'Exam', 'Dashboard', 'Leaderboard']) {
      expect(screen.getByRole('link', { name })).toBeInTheDocument();
    }
    learner.unmount();

    renderShell('admin');
    expect(await screen.findByRole('link', { name: 'Admin' })).toBeInTheDocument();
    expect(screen.getByText(/Not affiliated with or endorsed by CompTIA/)).toBeInTheDocument();
  });

  it('AppShell names the header stats in text', async () => {
    renderShell('learner');
    const stats = (await screen.findByText(/Level 3/)).closest('p');
    expect(stats).toHaveTextContent('Your progress: 120 XP · Level 3 · 4-day streak');
    expect(stats).not.toHaveAttribute('aria-label');
  });

  it('AppShell shows the new totals after a page reports XP, and the level-up above the page', async () => {
    let stats = { ...STATS, xp: 390, level: 2, nextLevelXp: 400 };
    function Page() {
      const { report } = useRewards();
      return <button type="button" onClick={() => report({ xp: 20 })}>Earn</button>;
    }
    renderShell('learner', vi.fn(), <Page />, () => stats);
    expect((await screen.findByText(/Level 2/)).closest('p')).toHaveTextContent('390 XP · Level 2 · 4-day streak');
    expect(screen.queryByText('Level up')).not.toBeInTheDocument();

    stats = { ...stats, xp: 410, level: 3, nextLevelXp: 900 };
    await userEvent.click(screen.getByRole('button', { name: 'Earn' }));
    await waitFor(() => expect(screen.getByText('4-day streak').closest('p')).toHaveTextContent('410 XP · Level 3 · 4-day streak'));
    const celebration = (await screen.findByText('Level up')).closest('[role="status"]');
    expect(celebration).toHaveTextContent('Level 3');
    // Between the header and the page, so that it is read before the page content.
    expect(celebration!.compareDocumentPosition(screen.getByRole('main')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(celebration!.compareDocumentPosition(screen.getByRole('banner')) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  it('AppShell reports a failed sign-out instead of leaving a rejected promise', async () => {
    const logout = vi.fn().mockRejectedValue(new ApiError(0, "Can't reach the server"));
    renderShell('learner', logout);
    await screen.findByText(/Level 3/);
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(logout).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't sign out. Try again.");
  });

  describe('SaveIndicator', () => {
    it('says "Not saved yet" while a save is being retried and clears once it is saved', async () => {
      let finish!: () => void;
      const run = vi
        .fn()
        .mockRejectedValueOnce(new ApiError(0, 'offline'))
        .mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)));
      const queue = createSaveQueue(undefined, { delaysMs: [5] });
      render(<SaveIndicator queue={queue} />);
      expect(screen.getByRole('status')).toBeEmptyDOMElement();

      act(() => queue.enqueue('a', run));
      expect(screen.getByRole('status')).toHaveTextContent('Saving…');
      expect(await screen.findByText('Not saved yet. Retrying…')).toBeInTheDocument();

      await waitFor(() => expect(run).toHaveBeenCalledTimes(2));
      finish();
      await waitFor(() => expect(screen.getByRole('status')).toBeEmptyDOMElement());
    });

    it('tells the learner when a save was dropped, until dismissed', async () => {
      const queue = createSaveQueue();
      render(<SaveIndicator queue={queue} />);
      act(() => queue.enqueue('a', () => Promise.reject(new ApiError(400, 'Bad input'))));
      expect(await screen.findByRole('status')).toHaveTextContent("Couldn't save one of your answers.");

      await userEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));
      expect(screen.getByRole('status')).toBeEmptyDOMElement();
      expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument();
      expect(queue.state()).toBe('idle');
    });

    it('keeps keyboard focus in place when the message is dismissed', async () => {
      const queue = createSaveQueue();
      render(
        <>
          <button type="button">Before</button>
          <SaveIndicator queue={queue} />
          <button type="button">After</button>
        </>,
      );
      act(() => queue.enqueue('a', () => Promise.reject(new ApiError(400, 'Bad input'))));
      const dismiss = await screen.findByRole('button', { name: 'Dismiss' });
      await userEvent.tab();
      await userEvent.tab();
      expect(dismiss).toHaveFocus();

      await userEvent.keyboard('{Enter}');
      expect(dismiss).not.toBeInTheDocument();
      expect(document.body).not.toHaveFocus();
      expect(screen.getByRole('status').parentElement).toHaveFocus();

      await userEvent.tab();
      expect(screen.getByRole('button', { name: 'After' })).toHaveFocus();
    });
  });

  describe('ErrorBoundary', () => {
    // React reports errors caught by a boundary to the console by default; the tests expect them.
    const quiet = { onCaughtError: () => {} };

    it('shows "Can\'t reach the server" with the footer, and Retry mounts the screen again', async () => {
      let offline = true;
      const onRetry = vi.fn(() => { offline = false; });
      function Screen() {
        if (offline) throw new ApiError(0, "Can't reach the server");
        return <p>back online</p>;
      }
      render(<ErrorBoundary onRetry={onRetry}><Screen /></ErrorBoundary>, quiet);
      expect(screen.getByRole('alert')).toHaveTextContent("Can't reach the server");
      expect(screen.getByRole('heading', { name: "Can't reach the server" })).toBeInTheDocument();
      expect(screen.getByText(FOOTER)).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(screen.getByText('back online')).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('treats a 503 like a network failure and stays on the error screen while the server is down', async () => {
      function Screen(): never {
        throw new ApiError(503, 'Service unavailable');
      }
      render(<ErrorBoundary><Screen /></ErrorBoundary>, quiet);
      await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
      expect(screen.getByRole('heading', { name: "Can't reach the server" })).toBeInTheDocument();
    });

    it('shows a general message for any other error', () => {
      function Screen(): never {
        throw new Error('boom');
      }
      render(<ErrorBoundary><Screen /></ErrorBoundary>, quiet);
      expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument();
      expect(screen.getByText(FOOTER)).toBeInTheDocument();
    });
  });

  it('ThemeToggle sets data-theme on <html> and persists it', async () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    render(<ThemeToggle />);
    await userEvent.click(screen.getByRole('button', { name: /light theme/i }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(localStorage.getItem('theme')).toBe('light');
    await userEvent.click(screen.getByRole('button', { name: /dark theme/i }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(localStorage.getItem('theme')).toBe('dark');
  });

  describe('Celebration', () => {
    beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
    afterEach(() => vi.useRealTimers());

    it('announces itself and calls onDone when dismissed', async () => {
      const onDone = vi.fn();
      render(<Celebration kind="level-up" title="Level 4" detail="Keep going" onDone={onDone} />);
      expect(screen.getByRole('status')).toHaveTextContent('Level 4');
      expect(screen.getByRole('status')).toHaveTextContent('Keep going');
      expect(screen.getByRole('status').getAttribute('style')).toContain('opacity'); // entrance animation
      await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
      expect(onDone).toHaveBeenCalledTimes(1);
    });

    it('calls onDone by itself after a few seconds', () => {
      const onDone = vi.fn();
      render(<Celebration kind="badge" title="Badge" onDone={onDone} />);
      act(() => { vi.advanceTimersByTime(7000); });
      expect(onDone).toHaveBeenCalledTimes(1);
    });

    it('does not restart its timer when onDone changes identity, and calls the latest one', () => {
      const first = vi.fn();
      const latest = vi.fn();
      const { rerender } = render(<Celebration kind="badge" title="Badge" onDone={first} />);
      act(() => { vi.advanceTimersByTime(4000); });
      rerender(<Celebration kind="badge" title="Badge" onDone={latest} />);
      act(() => { vi.advanceTimersByTime(2000); });
      expect(latest).toHaveBeenCalledTimes(1);
      expect(first).not.toHaveBeenCalled();
    });
  });
});
