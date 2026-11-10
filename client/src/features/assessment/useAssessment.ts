import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';
import type { AssessmentView } from '../../api/types';

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

// The assessments this app has already seen finalized, so that each finalization is acted on once.
const seenFinalized = new WeakMap<QueryClient, Set<number>>();

/**
 * One assessment, always read from the server: its answers, flags and deadline may have changed on another
 * device, and the server finalizes an exam whose deadline has passed the next time it is read.
 */
export function useAssessment(id: string) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['assessment', id], queryFn: () => load(id), staleTime: Infinity, gcTime: 0 });
  const { refetch } = query;
  const view = query.data?.view;
  // True once this visit has seen the assessment go from open to finalized.
  const [finishedHere, setFinishedHere] = useState(false);

  /**
   * Every finalized assessment passes through here, and is acted on the first time only. What it changed
   * (XP, the path, the exam history) is read again. `fresh`: it was finalized during this visit; its
   * `result.xp` and `result.newBadges` are then for Task 20's rewards provider to report.
   */
  const noteFinalized = useCallback(
    (finalized: AssessmentView, fresh: boolean) => {
      let seen = seenFinalized.get(queryClient);
      if (!seen) seenFinalized.set(queryClient, (seen = new Set()));
      if (!finalized.result || seen.has(finalized.id)) return;
      seen.add(finalized.id);
      if (fresh) setFinishedHere(true);
      void queryClient.invalidateQueries({ queryKey: ['path'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    [queryClient],
  );

  // An exam that the server finalized while the learner was away arrives finalized on the first read.
  useEffect(() => {
    if (view) noteFinalized(view, false);
  }, [view, noteFinalized]);

  /** Reads the assessment again. Only an open assessment is re-read, so a result it returns is new. Rejects on failure. */
  const reload = useCallback(async (): Promise<AssessmentView> => {
    const { data } = await refetch({ throwOnError: true });
    if (!data) throw new Error('The assessment could not be read');
    noteFinalized(data.view, true);
    return data.view;
  }, [refetch, noteFinalized]);

  return { query, view, clockOffsetMs: query.data?.clockOffsetMs ?? null, reload, finishedHere };
}
