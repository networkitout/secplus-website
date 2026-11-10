import type { QueryClient } from '@tanstack/react-query';
import type { Answer } from '../../../../shared/types';
import { api, ApiError } from '../../api/client';
import { createSaveQueue, guardUnload, type SaveQueue } from '../../api/saveQueue';
import type { AnswerSaveResponse } from '../../api/types';

/** What one save sends: the answer to a question, or its flag. */
export type SaveBody = { questionId: string; answer?: Answer; flagged?: boolean };

/**
 * The saves of one exam. There is one per exam for as long as the app runs, not one per visit to the exam
 * page: a learner who leaves while a save is retrying and comes back gets the same queue, so the retry and
 * a newer answer to the same question cannot overtake each other.
 */
export interface ExamSaves {
  /** Its state is what the exam page shows beside the timer. */
  queue: SaveQueue;
  /** Saves an answer (key: the question id) or a flag (key: `flag:` + the question id). The newest per key wins. */
  save(key: string, body: SaveBody): void;
  /**
   * The newest save per key that the server has not confirmed: on its way, waiting for a retry, or rejected.
   * Once the queue has been flushed, what is left here was rejected.
   */
  unconfirmed: ReadonlyMap<string, SaveBody>;
  /** Sends everything in `unconfirmed` again. */
  retry(): void;
  /** Set by the exam page while it is open. Called once, when a save is refused because the exam is finalized. */
  onClosed: (() => void) | null;
}

// Keyed by the app's query client, so that the saves live exactly as long as the rest of the app's data.
const registries = new WeakMap<QueryClient, Map<number, ExamSaves & { discard(): void }>>();

export function examSaves(queryClient: QueryClient, assessmentId: number): ExamSaves {
  const registry = registries.get(queryClient) ?? new Map<number, ExamSaves & { discard(): void }>();
  registries.set(queryClient, registry);
  const existing = registry.get(assessmentId);
  if (existing) return existing;

  const queue = createSaveQueue();
  const removeGuard = guardUnload(queue);
  const unconfirmed = new Map<string, SaveBody>();
  let closed = false;
  const saves: ExamSaves & { discard(): void } = {
    queue,
    unconfirmed,
    onClosed: null,
    save(key, body) {
      unconfirmed.set(key, body);
      queue.enqueue(key, async () => {
        // Once the server has said that the exam is finalized, nothing more can be saved.
        if (closed) return;
        try {
          await api.put<AnswerSaveResponse>(`assessments/${assessmentId}/answers`, body);
        } catch (err) {
          if (!(err instanceof ApiError && err.status === 409)) throw err;
          // Not a save to retry or to report as lost: the exam is over, and its results say what counted.
          closed = true;
          saves.onClosed?.();
          return;
        }
        if (unconfirmed.get(key) === body) unconfirmed.delete(key);
      });
    },
    retry() {
      for (const [key, body] of [...unconfirmed]) saves.save(key, body);
    },
    discard() {
      registry.delete(assessmentId);
      // Nothing that is still waiting matters any more: it is not sent, and leaving the page loses nothing.
      closed = true;
      removeGuard();
    },
  };
  registry.set(assessmentId, saves);
  return saves;
}

/** Forgets the saves of an exam: it is finalized, or nobody is looking at it and nothing is left to save. */
export function discardExamSaves(queryClient: QueryClient, assessmentId: number): void {
  registries.get(queryClient)?.get(assessmentId)?.discard();
}
