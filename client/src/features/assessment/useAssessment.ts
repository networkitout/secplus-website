import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api/client';
import type { AssessmentView } from '../../api/types';
import { useRewards } from '../rewards/RewardsProvider';

/** An assessment as read from the server, with what the read says about the server's clock. */
export interface LoadedAssessment {
  view: AssessmentView;
  /**
   * How far the server's clock is ahead of this device's, in milliseconds (negative when it is behind):
   * `serverNow` against the middle of the time the request took, so it is right to half the round trip.
   * `null` when the response carries no usable `serverNow`; nothing may then be timed by the device clock.
   */
  clockOffsetMs: number | null;
}

async function load(id: string): Promise<LoadedAssessment> {
  const sent = Date.now();
  const view = await api.get<AssessmentView>(`assessments/${encodeURIComponent(id)}`);
  const received = Date.now();
  const serverNow = Date.parse(view.serverNow ?? '');
  return { view, clockOffsetMs: Number.isNaN(serverNow) ? null : serverNow - (sent + received) / 2 };
}

// What this app has seen of each assessment since the page was loaded: that it was open, and that it was
// finalized. Each finalization is acted on once, and the app can tell a result that came about while it was
// looking from one the learner has come back to.
type Seen = { open: Set<number>; finalized: Set<number> };
const registries = new WeakMap<QueryClient, Seen>();

function seenBy(queryClient: QueryClient): Seen {
  let seen = registries.get(queryClient);
  if (!seen) registries.set(queryClient, (seen = { open: new Set(), finalized: new Set() }));
  return seen;
}

/**
 * One assessment, always read from the server: its answers, flags and deadline may have changed on another
 * device, and the server finalizes an exam whose deadline has passed the next time it is read.
 */
export function useAssessment(id: string) {
  const queryClient = useQueryClient();
  const { report } = useRewards();
  const query = useQuery({ queryKey: ['assessment', id], queryFn: () => load(id), staleTime: Infinity, gcTime: 0 });
  const { refetch } = query;
  const view = query.data?.view;
  // True once this visit has seen the assessment go from open to finalized.
  const [finishedHere, setFinishedHere] = useState(false);

  /**
   * Every read of the assessment passes through here. A finalized one is acted on the first time only.
   * `fresh`: it was finalized during this visit to the page.
   *
   * What the result earned (`result.xp`, `result.newBadges`: the XP of a quiz's answers is part of it) is
   * reported once, and only when this app has seen the assessment open: it was submitted from here, or
   * the server closed it meanwhile (an exam whose time ran out while the learner was on another screen).
   * A result that was already there when the app first read the assessment is one the learner has come
   * back to; what it earned was earned, and celebrated, earlier.
   */
  const note = useCallback(
    (read: AssessmentView, fresh: boolean) => {
      const seen = seenBy(queryClient);
      if (!read.result) {
        seen.open.add(read.id);
        return;
      }
      if (seen.finalized.has(read.id)) return;
      seen.finalized.add(read.id);
      if (fresh) setFinishedHere(true);
      const { xp, newBadges } = read.result;
      const news = seen.open.has(read.id);
      if (news) report({ xp, newBadges });
      void queryClient.invalidateQueries({ queryKey: ['path'] });
      // The dashboard is read again once, not twice: by `report` when something was earned, and here
      // otherwise (the exam history and the exam in progress have changed whatever was earned).
      if (!(news && (xp > 0 || newBadges.length > 0))) void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    [queryClient, report],
  );

  // True while `reload` is under way. Only an open assessment is re-read, so a result that turns up
  // meanwhile is new, whether this hook hears of it from the read itself or from the render it causes.
  const reloading = useRef(false);

  // An exam that the server finalized while the learner was away arrives finalized on the first read.
  useEffect(() => {
    if (view) note(view, reloading.current);
  }, [view, note]);

  /** Reads the assessment again. Rejects on failure. */
  const reload = useCallback(async (): Promise<AssessmentView> => {
    reloading.current = true;
    try {
      const { data } = await refetch({ throwOnError: true });
      if (!data) throw new Error('The assessment could not be read');
      note(data.view, true);
      return data.view;
    } finally {
      reloading.current = false;
    }
  }, [refetch, note]);

  return { query, view, clockOffsetMs: query.data?.clockOffsetMs ?? null, reload, finishedHere };
}
