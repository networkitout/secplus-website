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
import { AUTO_DISMISS_MS, Celebration } from '../../ui/Celebration';

export interface RewardsValue {
  /**
   * Tells the app what an API response earned: pass its `xp` and `newBadges` as they arrived. The header
   * reads its XP, level and streak again, and a new badge or level is celebrated. Nothing happens when the
   * response earned nothing.
   *
   * Returns whether the dashboard will be read again for it. A screen that needs that read for a reason
   * of its own asks for it only when this is false, so that there is one read and not two.
   */
  report(r: { xp?: number; newBadges?: string[] }): boolean;
}

/** A celebration that waits its turn. */
type Queued = { key: string; kind: 'level-up'; level: number } | { key: string; kind: 'badge'; id: string };

/** The celebration on screen. */
type Showing = { key: string; kind: 'level-up' | 'badge'; title: string; detail?: string };

type BannerValue = { showing: Showing | null; dismiss(key: string): void };

/** Makes the provider's celebrations wait; the function it returns lets them go on (calling it again does nothing). */
type Hold = () => () => void;

const DASHBOARD = ['dashboard'];

/**
 * How long a report waits for another one before the header's numbers are read again. Reports that arrive
 * in a burst (a response and its follow-up, two tabs' worth of answers at once) share one request. The
 * learner's own actions do not: the press guard keeps them half a second apart, so each rewarded action
 * has its own read and the header follows promptly.
 */
export const REFRESH_DELAY_MS = 300;

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

  // When the provider goes, the learner has signed out: a refresh that is still waiting is dropped, and a
  // report that arrives later (the response to a request of the old session) starts nothing. The next
  // session reads its own numbers.
  // True from the first render, so a report from a child's mount effect (which runs before this one) counts.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(refreshTimer.current);
    };
  }, []);

  const report = useCallback<RewardsValue['report']>(
    ({ xp = 0, newBadges = [] }) => {
      if (!mounted.current) return false;
      // A badge joins the queue at once; only the request for the header's numbers waits.
      const fresh = [...new Set(newBadges)].filter((id) => !seenBadges.current.has(id));
      for (const id of fresh) seenBadges.current.add(id);
      if (fresh.length > 0) {
        const items = fresh.map((id): Queued => ({ key: `badge-${(serial.current += 1)}`, kind: 'badge', id }));
        setQueue((q) => [...q, ...items]);
      }
      if (xp <= 0 && fresh.length === 0) return false;
      // The read follows the last report of a burst (see `REFRESH_DELAY_MS`).
      clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(refresh, REFRESH_DELAY_MS);
      return true;
    },
    [refresh],
  );

  const dismiss = useCallback((key: string) => setQueue((q) => q.filter((item) => item.key !== key)), []);

  const hold = useCallback<Hold>(() => {
    let holding = true;
    setHolds((n) => n + 1);
    return () => {
      if (!holding) return;
      holding = false;
      setHolds((n) => n - 1);
    };
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
 * passed, lesson complete. Outside a provider it works the same, without anything to hold back.
 *
 * - It is part of the page, so it does not go by itself (everything under it would move): it stays until
 *   the learner dismisses it or leaves the page.
 * - It comes first. The levels and badges of the provider wait while it is on screen, but not longer than
 *   the six seconds a celebration lasts: after that they appear in their corner although this one is
 *   still there. Dismissing it, or leaving the page, lets them go on at once. So nothing the screen does
 *   or omits can hold the queue forever.
 * - It is not a live region: one that arrives together with its text is not announced by every screen
 *   reader. The screen gives it a `textId` and names that id in `aria-describedby` of the heading it moves
 *   focus to, so it is read with that heading, once.
 */
export function ScreenCelebration(props: Omit<ComponentProps<typeof Celebration>, 'live' | 'autoDismiss' | 'compact'>) {
  const hold = useContext(HoldContext);
  // A layout effect: the provider knows before the page is painted, so its own celebration is never seen
  // beside this one.
  useLayoutEffect(() => {
    if (!hold) return;
    const release = hold();
    const timer = setTimeout(release, AUTO_DISMISS_MS);
    return () => {
      clearTimeout(timer);
      release();
    };
  }, [hold]);
  return <Celebration {...props} live={false} autoDismiss={false} />;
}

/** What Tab stops at. */
const CONTROL = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

function overlap(a: DOMRect, b: DOMRect): boolean {
  return a.bottom > b.top && a.top < b.bottom && a.right > b.left && a.left < b.right;
}

const root = () => document.documentElement;

/** The room that is kept at the end of the page now, in px. */
const roomKept = () => parseFloat(root().style.getPropertyValue(SPACE)) || 0;

function keepRoom(px: number): void {
  if (px > 0) root().style.setProperty(SPACE, `${px}px`);
  else root().style.removeProperty(SPACE);
}

/** How high the page is without the room: the window's height at least, as the shell fills the window. */
const ownHeight = () => root().scrollHeight - roomKept();

/**
 * The room a celebration of this height needs at the end of the page, so that what lies under it can be
 * scrolled clear of it:
 *
 * - a page that scrolls by itself gets the celebration's height. The room is beyond the end of the page,
 *   so nothing on screen moves.
 * - a page that fits into the window gets none, as long as its content ends above the celebration: the
 *   room would only push the footer up from the window's edge.
 * - a page that fits into the window but reaches under the celebration gets the height too. That page
 *   then scrolls, by as much as it takes to bring its end above the celebration.
 */
function roomNeeded(height: number, card: Element): number {
  if (ownHeight() > window.innerHeight) return height;
  const main = document.querySelector('main');
  const contentEnd = Math.max(0, ...[...(main?.children ?? [])].map((el) => el.getBoundingClientRect().bottom + window.scrollY));
  return contentEnd > card.getBoundingClientRect().top ? height : 0;
}

/**
 * Gives back the room once no celebration is showing. On a page that fits into the window all of it goes:
 * that page only scrolls because of the room. On a page that scrolls by itself, the part the page is
 * scrolled into stays (taking it away would move everything on screen) and goes as the learner scrolls
 * away from it.
 */
function giveBackRoom(): void {
  const kept = roomKept();
  if (kept === 0) return keepRoom(0);
  const own = ownHeight();
  const inUse = own <= window.innerHeight ? 0 : Math.min(kept, Math.max(0, Math.ceil(window.scrollY + window.innerHeight - own)));
  keepRoom(inUse);
}

/**
 * Where the celebrations of `RewardsProvider` appear: one at a time, each until it is dismissed or its few
 * seconds are over.
 *
 * It lies over the bottom corner of the window, so nothing on the page moves when it comes or goes, and
 * the bars that stay at the top of some screens (the exam's timer, a lab's scenario) are never under it.
 * While it shows, what is scrolled into view stops above it (`--celebration-cover`, read by
 * `scroll-padding-bottom`), a control that has focus and would lie under it is scrolled clear at once, and
 * the page keeps room at its end where it needs it (`--celebration-space`, read by the shell; see
 * `roomNeeded` and `giveBackRoom`). It never takes focus. Its Dismiss button is reached with Tab, after
 * the header; a press on it that arrives with the celebration is ignored.
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
  // Where focus was before the learner moved it into the banner.
  const cameFrom = useRef<HTMLElement | null>(null);
  const shown = showing?.key;

  useLayoutEffect(() => {
    const el = box.current;
    const card = region.current;
    if (shown === undefined || !el || !card) return;
    // Measured again whenever the banner, the page or the window changes its size: the text of the banner
    // wraps differently, the learner goes to another page, the window is resized or turned.
    const measure = () => {
      root().style.setProperty(COVER, `${el.offsetHeight}px`);
      keepRoom(roomNeeded(el.offsetHeight, card));
    };
    measure();
    const active = document.activeElement;
    if (active instanceof HTMLElement && !el.contains(active) && active.matches(CONTROL) && overlap(active.getBoundingClientRect(), card.getBoundingClientRect())) {
      active.scrollIntoView({ block: 'nearest' });
    }
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(el);
    observer?.observe(document.body);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [shown]);

  // No celebration: nothing is covered, and the room is given back, at once as far as that moves nothing
  // and then as the learner scrolls. (Between two celebrations in a row this does not run: the room stays.)
  useLayoutEffect(() => {
    if (shown !== undefined) return;
    root().style.removeProperty(COVER);
    giveBackRoom();
    window.addEventListener('scroll', giveBackRoom, { passive: true });
    window.addEventListener('resize', giveBackRoom);
    return () => {
      window.removeEventListener('scroll', giveBackRoom);
      window.removeEventListener('resize', giveBackRoom);
    };
  }, [shown]);

  // With the banner itself, everything it set goes.
  useEffect(
    () => () => {
      root().style.removeProperty(COVER);
      keepRoom(0);
    },
    [],
  );

  function done(key: string) {
    // The Dismiss button is about to go. Focus returns to where the learner came from, without scrolling
    // the page to it (a tap on Dismiss must not move the page); if that place is not known or is gone,
    // focus stays on the banner, so that the next Tab continues from here.
    if (box.current?.contains(document.activeElement)) {
      if (cameFrom.current?.isConnected) cameFrom.current.focus({ preventScroll: true });
      else box.current.focus({ preventScroll: true });
    }
    dismiss(key);
  }

  return (
    <div
      ref={box}
      tabIndex={-1}
      onFocus={(e) => {
        if (e.relatedTarget instanceof HTMLElement && !e.currentTarget.contains(e.relatedTarget)) cameFrom.current = e.relatedTarget;
        else if (e.relatedTarget === null) cameFrom.current = null;
      }}
      className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-end px-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
    >
      <div ref={region} role="status" aria-label="Rewards" className={`pointer-events-auto w-full max-w-sm rounded-lg ${showing ? 'shadow-xl' : ''}`}>
        {showing && (
          <Celebration key={showing.key} live={false} compact kind={showing.kind} title={showing.title} detail={showing.detail} onDone={() => done(showing.key)} />
        )}
      </div>
    </div>
  );
}
