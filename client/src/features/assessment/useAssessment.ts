import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { api } from '../../api/client';
import type { AssessmentResult, AssessmentView } from '../../api/types';

/**
 * One assessment, always read from the server: its answers, flags and deadline may have changed on another
 * device, and the server finalizes an exam whose deadline has passed the next time it is read.
 */
export function useAssessment(id: string) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['assessment', id],
    queryFn: () => api.get<AssessmentView>(`assessments/${encodeURIComponent(id)}`),
    staleTime: Infinity,
    gcTime: 0,
  });
  const { refetch } = query;
  // True once this visit has seen the assessment go from open to finalized.
  const [finishedHere, setFinishedHere] = useState(false);

  /**
   * The result of an assessment that was finalized during this visit arrives here, once. Its `xp` and
   * `newBadges` are for Task 20's rewards provider; until then the screens that show totals re-read them.
   */
  const finalized = useCallback(
    (_result: AssessmentResult) => {
      setFinishedHere(true);
      void queryClient.invalidateQueries({ queryKey: ['path'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    [queryClient],
  );

  /** Reads the assessment again. Only an open assessment is re-read, so a result it returns is new. Rejects on failure. */
  const reload = useCallback(async (): Promise<AssessmentView> => {
    const { data } = await refetch({ throwOnError: true });
    if (!data) throw new Error('The assessment could not be read');
    if (data.result) finalized(data.result);
    return data;
  }, [refetch, finalized]);

  return { query, reload, finishedHere };
}
