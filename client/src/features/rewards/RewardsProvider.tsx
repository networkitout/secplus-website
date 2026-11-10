import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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

const DASHBOARD = ['dashboard'];

export const RewardsContext = createContext<RewardsValue | null>(null);
const BannerContext = createContext<BannerValue | null>(null);

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
 */
export function RewardsProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const dashboard = useQuery({ queryKey: DASHBOARD, queryFn: () => api.get<DashboardResponse>('dashboard') });
  const [queue, setQueue] = useState<Queued[]>([]);
  const serial = useRef(0);
  const seenBadges = useRef(new Set<string>());
  const lastLevel = useRef<number | undefined>(undefined);
  const rereadOnceLoaded = useRef(false);

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

  const report = useCallback<RewardsValue['report']>(
    ({ xp = 0, newBadges = [] }) => {
      const fresh = [...new Set(newBadges)].filter((id) => !seenBadges.current.has(id));
      for (const id of fresh) seenBadges.current.add(id);
      if (fresh.length > 0) {
        const items = fresh.map((id): Queued => ({ key: `badge-${(serial.current += 1)}`, kind: 'badge', id }));
        setQueue((q) => [...q, ...items]);
      }
      if (xp <= 0 && fresh.length === 0) return;
      const state = queryClient.getQueryState(DASHBOARD);
      if (state?.data === undefined && state?.fetchStatus === 'fetching') rereadOnceLoaded.current = true;
      else void queryClient.invalidateQueries({ queryKey: DASHBOARD });
    },
    [queryClient],
  );

  const dismiss = useCallback((key: string) => setQueue((q) => q.filter((item) => item.key !== key)), []);

  const head = queue[0];
  const badges = dashboard.data?.badges;
  // A badge is shown by its name, which the dashboard has. Without a dashboard yet, it waits for it.
  const namesSettled = loaded || dashboard.isError;
  const showing = useMemo((): Showing | null => {
    if (!head) return null;
    if (head.kind === 'level-up') return { key: head.key, kind: 'level-up', title: `Level ${head.level}`, detail: 'You reached a new level.' };
    const badge = badges?.find((b) => b.id === head.id);
    if (badge) return { key: head.key, kind: 'badge', title: badge.title, detail: badge.description };
    return namesSettled ? { key: head.key, kind: 'badge', title: 'New badge' } : null;
  }, [head, badges, namesSettled]);

  const rewards = useMemo(() => ({ report }), [report]);
  const banner = useMemo(() => ({ showing, dismiss }), [showing, dismiss]);

  return (
    <RewardsContext.Provider value={rewards}>
      <BannerContext.Provider value={banner}>{children}</BannerContext.Provider>
    </RewardsContext.Provider>
  );
}

/**
 * Where the celebrations of `RewardsProvider` appear: one at a time, each until it is dismissed or its few
 * seconds are over. It stays at the top of the window while the page scrolls.
 */
export function RewardsBanner() {
  const banner = useContext(BannerContext);
  const box = useRef<HTMLDivElement>(null);
  if (!banner) throw new Error('RewardsBanner must be used inside <RewardsProvider>');
  const { showing, dismiss } = banner;

  function done(key: string) {
    // The Dismiss button is about to go: focus stays here, so that the next Tab continues from this place.
    if (box.current?.contains(document.activeElement)) box.current.focus();
    dismiss(key);
  }

  return (
    <div ref={box} tabIndex={-1} className="sticky top-2 z-30 mx-auto w-full max-w-6xl px-4">
      {showing && (
        <div className="pt-4">
          <Celebration key={showing.key} kind={showing.kind} title={showing.title} detail={showing.detail} onDone={() => done(showing.key)} />
        </div>
      )}
    </div>
  );
}
