import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react';
import { api } from '../../api/client';
import type { DashboardResponse } from '../../api/types';
import { Celebration } from '../../ui/Celebration';

export interface RewardsValue {
  /**
   * Tells the app what an API response earned: pass its `xp` and `newBadges` as they arrived. The header
   * reads its XP, level and streak again, and a new badge or level is celebrated. Nothing happens when the
   * response earned nothing.
   */
  report(r: { xp?: number; newBadges?: string[] }): void;
}

/** A celebration that waits its turn. */
type Queued = { key: string; kind: 'level-up'; level: number } | { key: string; kind: 'badge'; id: string };

/** The celebration on screen. */
type Showing = { key: string; kind: 'level-up' | 'badge'; title: string; detail?: string };

type BannerValue = { showing: Showing | null; dismiss(key: string): void };

/** Makes the provider's celebrations wait; the function it returns lets them go on. */
type Hold = () => () => void;

const DASHBOARD = ['dashboard'];

/**
 * How long a report waits for another one before the header's numbers are read again. Reports that follow
 * each other more closely than this share one request.
 */
const REFRESH_DELAY_MS = 300;

/** The room the page keeps at its end for a celebration over the bottom of the window (see `RewardsBanner`). */
const SPACE = '--celebration-space';
/** How much of the bottom of the window a celebration covers now: what is scrolled into view stops above it. */
const COVER = '--celebration-cover';

export const RewardsContext = createContext<RewardsValue | null>(null);
const BannerContext = createContext<BannerValue | null>(null);
const HoldContext = createContext<Hold | null>(null);

export function useRewards(): RewardsValue {
  const ctx = useContext(RewardsContext);
  if (!ctx) throw new Error('useRewards must be used inside <RewardsProvider>');
  return ctx;
}

/**
 * Turns what the API says was earned into a fresh header and into celebrations, one at a time.
 *
 * A level-up is read from the dashboard (the server owns the level formula): whenever its level is higher
 * than the level this provider saw before, there is one celebration, naming the new level. The level the
 * learner has when the page loads is the starting point and is not celebrated.
 *
 * It holds what one learner has seen, so it must not outlive that learner's session: mount a new one
 * (a `key`) when the account changes.
 */
export function RewardsProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const dashboard = useQuery({ queryKey: DASHBOARD, queryFn: () => api.get<DashboardResponse>('dashboard') });
  const [queue, setQueue] = useState<Queued[]>([]);
  // How many celebrations of their own the screens are showing; the queue waits behind them.
  const [holds, setHolds] = useState(0);
  const serial = useRef(0);
  const seenBadges = useRef(new Set<string>());
  const lastLevel = useRef<number | undefined>(undefined);
  const rereadOnceLoaded = useRef(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const loaded = dashboard.data !== undefined;
  const level = dashboard.data?.level;

  useEffect(() => {
    if (level === undefined) return;
    const before = lastLevel.current;
    lastLevel.current = level;
    if (before === undefined || level <= before) return;
    const key = `level-${(serial.current += 1)}`;
    // A level-up that has not been shown yet is out of date now: only the newest level is named.
    setQueue((q) => [...q.filter((item, i) => i === 0 || item.kind !== 'level-up'), { key, kind: 'level-up', level }]);
  }, [level]);

  // A report came in while the first dashboard response was still on its way. That response may have been
  // computed before the XP was earned, so the dashboard is read once more after it.
  useEffect(() => {
    if (!loaded || !rereadOnceLoaded.current) return;
    rereadOnceLoaded.current = false;
    void queryClient.invalidateQueries({ queryKey: DASHBOARD });
  }, [loaded, queryClient]);

  const refresh = useCallback(() => {
    refreshTimer.current = undefined;
    const state = queryClient.getQueryState(DASHBOARD);
    if (state?.data === undefined && state?.fetchStatus === 'fetching') rereadOnceLoaded.current = true;
    else void queryClient.invalidateQueries({ queryKey: DASHBOARD });
  }, [queryClient]);

  // A refresh that is still waiting when the provider goes is dropped: the learner has signed out, and
  // the next session reads its own numbers.
  useEffect(() => () => clearTimeout(refreshTimer.current), []);

  const report = useCallback<RewardsValue['report']>(
    ({ xp = 0, newBadges = [] }) => {
      // A badge joins the queue at once; only the request for the header's numbers waits.
      const fresh = [...new Set(newBadges)].filter((id) => !seenBadges.current.has(id));
      for (const id of fresh) seenBadges.current.add(id);
      if (fresh.length > 0) {
        const items = fresh.map((id): Queued => ({ key: `badge-${(serial.current += 1)}`, kind: 'badge', id }));
        setQueue((q) => [...q, ...items]);
      }
      if (xp <= 0 && fresh.length === 0) return;
      // The dashboard is a costly read, and a round of flashcards reports many times: the read follows
      // the last report of a burst.
      clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(refresh, REFRESH_DELAY_MS);
    },
    [refresh],
  );

  const dismiss = useCallback((key: string) => setQueue((q) => q.filter((item) => item.key !== key)), []);

  const hold = useCallback<Hold>(() => {
    setHolds((n) => n + 1);
    return () => setHolds((n) => n - 1);
  }, []);

  const head = queue[0];
  const badges = dashboard.data?.badges;
  // A badge is shown by its name, which the dashboard has. Without a dashboard yet, it waits for it.
  const namesSettled = loaded || dashboard.isError;
  const held = holds > 0;
  const showing = useMemo((): Showing | null => {
    if (!head || held) return null;
    if (head.kind === 'level-up') return { key: head.key, kind: 'level-up', title: `Level ${head.level}`, detail: 'You reached a new level.' };
    const badge = badges?.find((b) => b.id === head.id);
    if (badge) return { key: head.key, kind: 'badge', title: badge.title, detail: badge.description };
    return namesSettled ? { key: head.key, kind: 'badge', title: 'New badge' } : null;
  }, [head, held, badges, namesSettled]);

  const rewards = useMemo(() => ({ report }), [report]);
  const banner = useMemo(() => ({ showing, dismiss }), [showing, dismiss]);

  return (
    <RewardsContext.Provider value={rewards}>
      <HoldContext.Provider value={hold}>
        <BannerContext.Provider value={banner}>{children}</BannerContext.Provider>
      </HoldContext.Provider>
    </RewardsContext.Provider>
  );
}

/**
 * The celebration a screen shows for its own event, in its own place: quiz passed, exam passed, lab
 * passed, lesson complete. It comes first: while it is on screen, the levels and badges of the provider
 * wait, and appear one at a time once it has gone. Outside a provider it is a plain `Celebration`.
 */
export function ScreenCelebration(props: ComponentProps<typeof Celebration>) {
  const hold = useContext(HoldContext);
  // A layout effect: the provider knows before the page is painted, so its own celebration is never seen
  // beside this one.
  useLayoutEffect(() => hold?.(), [hold]);
  return <Celebration {...props} />;
}

/** What Tab stops at. */
const CONTROL = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

function overlap(a: DOMRect, b: DOMRect): boolean {
  return a.bottom > b.top && a.top < b.bottom && a.right > b.left && a.left < b.right;
}

/**
 * Gives back the room that was kept at the end of the page, as far as the page is not scrolled into it.
 * Taking away room that is on screen would move everything on the page; what is still in use goes when
 * the learner scrolls away from it.
 */
function giveBackRoom(): void {
  const root = document.documentElement;
  const room = root.style.getPropertyValue(SPACE);
  if (!room) return;
  const kept = parseFloat(room) || 0;
  const inUse = Math.min(kept, Math.max(0, Math.ceil(window.scrollY + window.innerHeight - (root.scrollHeight - kept))));
  if (inUse > 0) root.style.setProperty(SPACE, `${inUse}px`);
  else root.style.removeProperty(SPACE);
}

/**
 * Where the celebrations of `RewardsProvider` appear: one at a time, each until it is dismissed or its few
 * seconds are over.
 *
 * It lies over the bottom corner of the window, so nothing on the page moves when it comes or goes, and
 * the bars that stay at the top of some screens (the exam's timer, a lab's scenario) are never under it.
 * While it shows, the page keeps as much room at its end (`--celebration-space`, read by the shell), so
 * that anything under it can be scrolled clear, and what is scrolled into view stops above it
 * (`--celebration-cover`, read by `scroll-padding-bottom`); a control that has focus and would lie under
 * it is scrolled clear at once. When it goes, room that the page is scrolled into stays until the learner
 * scrolls away from it. It never takes focus. Its Dismiss button is reached with Tab, after the header.
 *
 * The live region is on the page from the start and the celebration is put into it: a region that arrives
 * together with its text is not announced by every screen reader.
 */
export function RewardsBanner() {
  const banner = useContext(BannerContext);
  if (!banner) throw new Error('RewardsBanner must be used inside <RewardsProvider>');
  const { showing, dismiss } = banner;
  const box = useRef<HTMLDivElement>(null);
  const region = useRef<HTMLDivElement>(null);
  const shown = showing?.key;

  useLayoutEffect(() => {
    const el = box.current;
    const card = region.current;
    if (shown === undefined || !el || !card) return;
    const root = document.documentElement;
    const reserve = () => {
      root.style.setProperty(SPACE, `${el.offsetHeight}px`);
      root.style.setProperty(COVER, `${el.offsetHeight}px`);
    };
    reserve();
    const active = document.activeElement;
    if (active instanceof HTMLElement && !el.contains(active) && active.matches(CONTROL) && overlap(active.getBoundingClientRect(), card.getBoundingClientRect())) {
      active.scrollIntoView({ block: 'nearest' });
    }
    // Its height changes when its text wraps differently (the window is resized or turned).
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(reserve);
    observer?.observe(el);
    return () => {
      observer?.disconnect();
      root.style.removeProperty(COVER);
      giveBackRoom();
    };
  }, [shown]);

  // Room that was still in use when the celebration went is given back as the learner scrolls away from it.
  useEffect(() => {
    if (shown !== undefined) return;
    window.addEventListener('scroll', giveBackRoom, { passive: true });
    window.addEventListener('resize', giveBackRoom);
    return () => {
      window.removeEventListener('scroll', giveBackRoom);
      window.removeEventListener('resize', giveBackRoom);
    };
  }, [shown]);

  // With the banner itself, the room goes too.
  useEffect(
    () => () => {
      document.documentElement.style.removeProperty(SPACE);
    },
    [],
  );

  function done(key: string) {
    // The Dismiss button is about to go: focus stays here, so that the next Tab continues from this place.
    if (box.current?.contains(document.activeElement)) box.current.focus();
    dismiss(key);
  }

  return (
    <div
      ref={box}
      tabIndex={-1}
      className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-end px-4 pb-[max(1rem,env(safe-area-inset-bottom))] focus:outline-none"
    >
      <div ref={region} role="status" aria-label="Rewards" className={`pointer-events-auto w-full max-w-sm rounded-lg ${showing ? 'shadow-xl' : ''}`}>
        {showing && (
          <Celebration key={showing.key} live={false} kind={showing.kind} title={showing.title} detail={showing.detail} onDone={() => done(showing.key)} />
        )}
      </div>
    </div>
  );
}
