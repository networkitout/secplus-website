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
  /** An exam page takes hold of the saves while it is mounted. They are kept for as long as anyone holds them. */
  acquire(): void;
  /** The page lets go. Once nobody holds the saves and nothing is left to send, they are forgotten. */
  release(): void;
}

type Entry = ExamSaves & { close(): void };

// Keyed by the app's query client, so that the saves live exactly as long as the rest of the app's data.
const registries = new WeakMap<QueryClient, Map<number, Entry>>();

/** The saves of an exam: the ones that exist, or new ones. A page that uses them must `acquire` them. */
export function examSaves(queryClient: QueryClient, assessmentId: number): ExamSaves {
  const registry = registries.get(queryClient) ?? new Map<number, Entry>();
  registries.set(queryClient, registry);
  const existing = registry.get(assessmentId);
  if (existing) return existing;

  const queue = createSaveQueue();
  const unconfirmed = new Map<string, SaveBody>();
  let holders = 0;
  let closed = false;
  let removeGuard: (() => void) | null = null;

  /** Forgotten saves still work for a page that got them a moment earlier: `acquire` brings them back. */
  const forget = () => {
    if (registry.get(assessmentId) === saves) registry.delete(assessmentId);
    removeGuard?.();
    removeGuard = null;
  };

  const saves: Entry = {
    queue,
    unconfirmed,
    onClosed: null,
    save(key, body) {
      unconfirmed.set(key, body);
      queue.enqueue(key, async () => {
        // Once the exam is finalized, nothing more can be saved.
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
    acquire() {
      holders++;
      if (closed) return;
      registry.set(assessmentId, saves);
      // Warns before the page is closed while a save is on its way.
      removeGuard ??= guardUnload(queue);
    },
    release() {
      holders--;
      if (holders > 0) return;
      void queue.flush().then(() => {
        if (holders === 0 && unconfirmed.size === 0) forget();
      });
    },
    close() {
      // Nothing that is still waiting matters any more: it is not sent, and leaving the page loses nothing.
      closed = true;
      forget();
    },
  };
  registry.set(assessmentId, saves);
  return saves;
}

/** The exam is finalized: its saves stop, whoever holds them, and are forgotten. */
export function closeExamSaves(queryClient: QueryClient, assessmentId: number): void {
  registries.get(queryClient)?.get(assessmentId)?.close();
}
