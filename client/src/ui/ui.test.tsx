import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '../api/types';
import { AuthContext } from '../features/auth/AuthProvider';
import { createQueryClient } from '../queryClient';
import { AppShell } from './AppShell';
import { Celebration } from './Celebration';
import { MasteryBar } from './MasteryBar';
import { ProgressRing } from './ProgressRing';
import { ThemeToggle } from './ThemeToggle';

const user = (role: User['role']): User => ({
  id: 1, login: 'sam', name: 'Sam', role, timeZone: 'UTC', examDate: null, hideFromLeaderboard: false,
});

function renderShell(role: User['role']) {
  vi.stubGlobal('fetch', vi.fn(async () =>
    new Response(JSON.stringify({ xp: 120, level: 3, nextLevelXp: 200, streak: 4 }), { status: 200 })));
  const auth = { user: user(role), loading: false, login: vi.fn(), logout: vi.fn(), refresh: vi.fn() };
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <AuthContext.Provider value={auth}>
        <MemoryRouter><AppShell><p>page body</p></AppShell></MemoryRouter>
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
    expect(screen.getByText('Not affiliated with or endorsed by CompTIA. Security+ is a trademark of CompTIA, Inc.')).toBeInTheDocument();
    for (const name of ['Path', 'Review', 'Labs', 'Exam', 'Dashboard', 'Leaderboard']) {
      expect(screen.getByRole('link', { name })).toBeInTheDocument();
    }
    learner.unmount();

    renderShell('admin');
    expect(await screen.findByRole('link', { name: 'Admin' })).toBeInTheDocument();
    expect(screen.getByText(/Not affiliated with or endorsed by CompTIA/)).toBeInTheDocument();
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
      await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
      expect(onDone).toHaveBeenCalledTimes(1);
    });

    it('calls onDone by itself after a few seconds', () => {
      const onDone = vi.fn();
      render(<Celebration kind="badge" title="Badge" onDone={onDone} />);
      act(() => { vi.advanceTimersByTime(7000); });
      expect(onDone).toHaveBeenCalledTimes(1);
    });
  });
});
