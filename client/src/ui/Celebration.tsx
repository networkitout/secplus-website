import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useId, useRef } from 'react';
import { usePressGuard } from './pressGuard';

export type CelebrationKind = 'lesson' | 'quiz-pass' | 'exam-pass' | 'lab-pass' | 'level-up' | 'badge' | 'streak';

const KIND_LABEL: Record<CelebrationKind, string> = {
  lesson: 'Lesson complete',
  'quiz-pass': 'Quiz passed',
  'exam-pass': 'Exam passed',
  'lab-pass': 'Lab passed',
  'level-up': 'Level up',
  badge: 'Badge earned',
  streak: 'Streak',
};

/** How long a celebration shows before it goes by itself. */
export const AUTO_DISMISS_MS = 6000;

export function Celebration({
  kind,
  title,
  detail,
  live = true,
  autoDismiss = true,
  compact = false,
  textId,
  onDone,
}: {
  kind: CelebrationKind;
  title: string;
  detail?: string;
  /**
   * By default it is a live region itself (`role="status"`). False where something else announces it (a
   * live region that was on the page before it, or a heading that takes focus and is described by it): it
   * is then a group, named after what happened.
   */
  live?: boolean;
  /**
   * By default it calls `onDone` by itself after a few seconds. False for one that is part of the page:
   * when that goes, everything under it moves, so it stays until the learner dismisses it.
   */
  autoDismiss?: boolean;
  /** Lower on a narrow screen (below `sm`): the detail is left to screen readers there. */
  compact?: boolean;
  /** An id for its text (what happened, the title, the detail; not the button), to describe something else with. */
  textId?: string;
  onDone: () => void;
}) {
  const reduced = useReducedMotion();
  const kindId = useId();
  // It may appear where the learner was about to press something else: a press on Dismiss that arrives
  // with it is ignored, so that it is not dismissed unread.
  const guard = usePressGuard();

  // The timer starts once; a parent re-render that passes a new `onDone` must not restart it.
  const latestOnDone = useRef(onDone);
  useEffect(() => {
    latestOnDone.current = onDone;
  }, [onDone]);
  useEffect(() => {
    if (!autoDismiss) return;
    const t = setTimeout(() => latestOnDone.current(), AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [autoDismiss]);

  const body = (
    <>
      <div id={textId} className="min-w-0">
        <p id={kindId} className="font-mono text-xs uppercase tracking-wide text-accent">
          {KIND_LABEL[kind]}
        </p>
        <p className={`font-semibold ${compact ? 'sm:text-lg' : 'text-lg'}`}>{title}</p>
        {detail && <p className={`text-sm text-muted ${compact ? 'sr-only sm:not-sr-only' : ''}`}>{detail}</p>}
      </div>
      <button
        type="button"
        onClick={() => guard.settled() && onDone()}
        className={`shrink-0 rounded-md border border-border text-sm hover:border-accent ${compact ? 'px-2 py-1 sm:px-3 sm:py-1.5' : 'px-3 py-1.5'}`}
      >
        Dismiss
      </button>
    </>
  );
  const cls = `flex items-center justify-between rounded-lg border border-accent bg-surface ${compact ? 'gap-3 p-3 sm:gap-4 sm:p-4' : 'gap-4 p-4'}`;
  const semantics = live ? { role: 'status' } : { role: 'group', 'aria-labelledby': kindId };

  // Under reduced motion the banner is static: no entrance animation.
  if (reduced) {
    return (
      <div {...semantics} className={cls}>
        {body}
      </div>
    );
  }
  return (
    <motion.div
      {...semantics}
      className={cls}
      initial={{ opacity: 0, y: -12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 300, damping: 22 }}
    >
      {body}
    </motion.div>
  );
}
