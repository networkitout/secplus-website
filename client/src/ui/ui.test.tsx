import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import { createSaveQueue } from '../api/saveQueue';
import type { User } from '../api/types';
import { AuthContext } from '../features/auth/AuthProvider';
import { RewardsProvider, useRewards } from '../features/rewards/RewardsProvider';
import { createQueryClient } from '../queryClient';
import { holdPressClock } from '../test/pressClock';
import { AppShell } from './AppShell';
import { AUTO_DISMISS_MS, Celebration } from './Celebration';
import { ConfirmDialog } from './ConfirmDialog';
import { ErrorBoundary } from './ErrorBoundary';
import { MasteryBar } from './MasteryBar';
import { SETTLE_MS } from './pressGuard';
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
  name = 'Sam',
) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(stats()), { status: 200 })));
  const auth = { user: { ...user(role), name }, loading: false, login: vi.fn(), logout, refresh: vi.fn() };
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

  it('AppShell shows the new totals after a page reports XP, and the level-up in the banner that follows the header', async () => {
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
    // It lies over the bottom of the window, but it follows the header and comes before the page in the
    // order of reading and of Tab.
    expect(celebration!.compareDocumentPosition(screen.getByRole('main')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(celebration!.compareDocumentPosition(screen.getByRole('banner')) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  it('AppShell lets a long display name wrap inside the header instead of widening the page', async () => {
    const name = 'Wolfeschlegelsteinhausenbergerdorffvoralternwarengewissenhaftscha'.slice(0, 64);
    expect(name).toHaveLength(64);
    renderShell('learner', vi.fn(), <p>page body</p>, () => STATS, name);
    // The whole name is there, for everyone: it breaks where it has to instead of being cut.
    const link = await screen.findByRole('link', { name });
    expect(link).toHaveAttribute('href', '/settings');
    expect(link).toHaveClass('min-w-0', 'max-w-full', '[overflow-wrap:anywhere]');
    // The row it is in may become narrower than its content.
    expect(link.parentElement).toHaveClass('min-w-0');
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

    it('says "some" when more than one answer was dropped, and "one" again when only one is left', async () => {
      const queue = createSaveQueue();
      render(<SaveIndicator queue={queue} />);
      act(() => {
        queue.enqueue('a', () => Promise.reject(new ApiError(400, 'Bad input')));
        queue.enqueue('b', () => Promise.reject(new ApiError(400, 'Bad input')));
      });
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent("Couldn't save some of your answers."));
      expect(queue.dropped()).toBe(2);

      // A later save of one of them goes through: one answer is still missing.
      act(() => queue.enqueue('a', () => Promise.resolve()));
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent("Couldn't save one of your answers."));
      expect(queue.dropped()).toBe(1);

      await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
      expect(screen.getByRole('status')).toBeEmptyDOMElement();
      expect(queue.dropped()).toBe(0);
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

  describe('ConfirmDialog', () => {
    function Host({ onConfirm = () => {}, busy = false }: { onConfirm?: () => void; busy?: boolean }) {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Delete account</button>
          <button>Something else</button>
          {open && (
            <ConfirmDialog title="Delete it?" confirmLabel="Delete" cancelLabel="Keep it" busy={busy} onConfirm={onConfirm} onCancel={() => setOpen(false)}>
              <p>This cannot be undone.</p>
            </ConfirmDialog>
          )}
        </>
      );
    }
    const opener = () => screen.getByRole('button', { name: 'Delete account' });
    const dialog = () => screen.getByRole('dialog', { name: 'Delete it?' });

    it('is a labelled modal dialog: focus moves in, stays in, and returns to the opener on Escape', async () => {
      render(<Host />);
      await userEvent.click(opener());
      expect(dialog()).toHaveAttribute('aria-modal', 'true');
      expect(dialog()).toHaveAccessibleDescription('This cannot be undone.');
      const keep = screen.getByRole('button', { name: 'Keep it' });
      const confirm = screen.getByRole('button', { name: 'Delete' });
      // Focus starts on the choice that changes nothing.
      expect(keep).toHaveFocus();

      await userEvent.tab();
      expect(confirm).toHaveFocus();
      await userEvent.tab();
      expect(keep).toHaveFocus();
      await userEvent.tab({ shift: true });
      expect(confirm).toHaveFocus();

      await userEvent.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(opener()).toHaveFocus();
    });

    it('Escape and Tab still work after a click on the dialog text has taken focus off the buttons', async () => {
      render(<Host />);
      await userEvent.click(opener());
      await userEvent.click(screen.getByText('This cannot be undone.'));
      expect(screen.getByRole('button', { name: 'Keep it' })).not.toHaveFocus();
      await userEvent.tab({ shift: true });
      expect(screen.getByRole('button', { name: 'Delete' })).toHaveFocus();

      await userEvent.click(screen.getByText('This cannot be undone.'));
      await userEvent.tab();
      expect(screen.getByRole('button', { name: 'Keep it' })).toHaveFocus();

      await userEvent.click(screen.getByText('This cannot be undone.'));
      await userEvent.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(opener()).toHaveFocus();
    });

    it('keeps every control of its body within reach of Tab: a link and a field, not only its two buttons', async () => {
      render(
        <ConfirmDialog title="Invite link" confirmLabel="Done" cancelLabel="Close" onConfirm={() => {}} onCancel={() => {}}>
          <p>
            Read <a href="/help">how invites work</a>.
          </p>
          <label>
            Link <input readOnly value="https://example.test/invite/abc" />
          </label>
          <button disabled>Not available</button>
        </ConfirmDialog>,
      );
      const link = screen.getByRole('link', { name: 'how invites work' });
      const field = screen.getByRole('textbox', { name: 'Link' });
      const close = screen.getByRole('button', { name: 'Close' });
      const done = screen.getByRole('button', { name: 'Done' });
      // Focus still starts on the choice that changes nothing, not on the first thing in the body.
      expect(close).toHaveFocus();

      await userEvent.tab();
      expect(done).toHaveFocus();
      await userEvent.tab();
      expect(link).toHaveFocus();
      await userEvent.tab();
      expect(field).toHaveFocus();
      await userEvent.tab();
      expect(close).toHaveFocus();
      await userEvent.tab({ shift: true });
      expect(field).toHaveFocus();
      await userEvent.tab({ shift: true });
      expect(link).toHaveFocus();
      await userEvent.tab({ shift: true });
      expect(done).toHaveFocus();
    });

    it('the cancel button and a click outside the dialog cancel; the confirm button confirms', async () => {
      const onConfirm = vi.fn();
      render(<Host onConfirm={onConfirm} />);
      await userEvent.click(opener());
      await userEvent.click(screen.getByRole('button', { name: 'Keep it' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      await userEvent.click(opener());
      fireEvent.mouseDown(dialog().parentElement!);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      // A press inside the dialog is not a press outside it.
      await userEvent.click(opener());
      fireEvent.mouseDown(dialog());
      expect(dialog()).toBeInTheDocument();
      expect(onConfirm).not.toHaveBeenCalled();

      await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it('ignores a press that arrives as it opens: the second half of a double click neither confirms nor cancels', async () => {
      const clock = holdPressClock();
      const onConfirm = vi.fn();
      render(<Host onConfirm={onConfirm} />);
      // The page has been on screen for a while: what counts from here on is when the dialog opened.
      clock.advance(SETTLE_MS);
      // The second click of a double click on the opener lands on whatever the dialog has put there.
      await userEvent.click(opener());
      await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
      await userEvent.click(screen.getByRole('button', { name: 'Keep it' }));
      fireEvent.mouseDown(dialog().parentElement!);
      // A held Enter repeats on the button that has focus, which is the cancel button.
      await userEvent.keyboard('{Enter}{Enter}');
      clock.advance(SETTLE_MS - 1);
      await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
      expect(onConfirm).not.toHaveBeenCalled();
      expect(dialog()).toBeInTheDocument();

      clock.advance(1);
      await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
      expect(onConfirm).toHaveBeenCalledTimes(1);
      await userEvent.click(screen.getByRole('button', { name: 'Keep it' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      // Escape is a key of its own, not a press that was meant for something else: it works at once.
      await userEvent.click(opener());
      await userEvent.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('while busy the confirm button says so and does not confirm again', async () => {
      const onConfirm = vi.fn();
      render(<Host onConfirm={onConfirm} busy />);
      await userEvent.click(opener());
      const confirm = screen.getByRole('button', { name: 'Delete' });
      expect(confirm).toHaveAttribute('aria-busy', 'true');
      // Not disabled: a disabled button would drop keyboard focus.
      expect(confirm).toBeEnabled();
      await userEvent.click(confirm);
      expect(onConfirm).not.toHaveBeenCalled();
    });
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

    it('labels a finished lesson as "Lesson complete"', () => {
      render(<Celebration kind="lesson" title="Security controls" detail="+50 XP" onDone={vi.fn()} />);
      const banner = screen.getByRole('status');
      expect(banner).toHaveTextContent('Lesson complete');
      expect(banner).toHaveTextContent('Security controls');
      expect(banner).toHaveTextContent('+50 XP');
      expect(banner).not.toHaveTextContent('Streak');
    });

    it('labels a passed lab as "Lab passed"', () => {
      render(<Celebration kind="lab-pass" title="Classify the controls" detail="+121 XP" onDone={vi.fn()} />);
      const banner = screen.getByRole('status');
      expect(banner).toHaveTextContent('Lab passed');
      expect(banner).toHaveTextContent('Classify the controls');
      expect(banner).toHaveTextContent('+121 XP');
      expect(banner).not.toHaveTextContent('Quiz passed');
    });

    it('labels a passed exam as "Exam passed"', () => {
      render(<Celebration kind="exam-pass" title="Domain 1 exam" detail="+300 XP" onDone={vi.fn()} />);
      const banner = screen.getByRole('status');
      expect(banner).toHaveTextContent('Exam passed');
      expect(banner).toHaveTextContent('Domain 1 exam');
      expect(banner).not.toHaveTextContent('Quiz passed');
    });

    it('stays until it is dismissed when it is told not to go by itself', async () => {
      const onDone = vi.fn();
      render(<Celebration kind="quiz-pass" title="Objective 1.1" autoDismiss={false} onDone={onDone} />);
      act(() => { vi.advanceTimersByTime(60_000); });
      expect(onDone).not.toHaveBeenCalled();
      await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
      expect(onDone).toHaveBeenCalledTimes(1);
    });

    it('a press on Dismiss that arrives with it is ignored; going by itself is not held back', async () => {
      const clock = holdPressClock();
      const onDone = vi.fn();
      render(<Celebration kind="level-up" title="Level 4" onDone={onDone} />);
      // A press that was on its way to whatever the celebration now lies over.
      await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
      clock.advance(SETTLE_MS - 1);
      await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
      expect(onDone).not.toHaveBeenCalled();
      act(() => { vi.advanceTimersByTime(AUTO_DISMISS_MS); });
      expect(onDone).toHaveBeenCalledTimes(1);

      clock.advance(1);
      await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
      expect(onDone).toHaveBeenCalledTimes(2);
    });

    it('where it is not a live region itself, it is a group named after what happened, and its text has an id to describe something with', () => {
      render(<Celebration kind="lab-pass" title="Classify the controls" detail="+121 XP" live={false} textId="what-happened" onDone={vi.fn()} />);
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      const group = screen.getByRole('group', { name: 'Lab passed' });
      expect(within(group).getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
      const text = document.getElementById('what-happened');
      expect(text).toHaveTextContent('Lab passedClassify the controls+121 XP');
      expect(text).not.toHaveTextContent('Dismiss');
    });

    it('compact: below the sm breakpoint the detail is left to screen readers and the card is two lines high', () => {
      render(<Celebration kind="badge" title="First Lesson" detail="Complete your first lesson." compact onDone={vi.fn()} />);
      expect(screen.getByText('Complete your first lesson.')).toHaveClass('sr-only', 'sm:not-sr-only');
      expect(screen.getByRole('status')).toHaveClass('p-3', 'sm:p-4');
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
