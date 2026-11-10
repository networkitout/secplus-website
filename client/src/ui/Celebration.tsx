import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef } from 'react';

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

const AUTO_DISMISS_MS = 6000;

export function Celebration({
  kind,
  title,
  detail,
  live = true,
  onDone,
}: {
  kind: CelebrationKind;
  title: string;
  detail?: string;
  /**
   * False when it is shown inside a live region that was on the page before it. By default it is a live
   * region itself (`role="status"`).
   */
  live?: boolean;
  onDone: () => void;
}) {
  const reduced = useReducedMotion();

  // The timer starts once; a parent re-render that passes a new `onDone` must not restart it.
  const latestOnDone = useRef(onDone);
  useEffect(() => {
    latestOnDone.current = onDone;
  }, [onDone]);
  useEffect(() => {
    const t = setTimeout(() => latestOnDone.current(), AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, []);

  const body = (
    <>
      <div>
        <p className="font-mono text-xs uppercase tracking-wide text-accent">{KIND_LABEL[kind]}</p>
        <p className="text-lg font-semibold">{title}</p>
        {detail && <p className="text-sm text-muted">{detail}</p>}
      </div>
      <button
        type="button"
        onClick={onDone}
        className="rounded-md border border-border px-3 py-1.5 text-sm hover:border-accent"
      >
        Dismiss
      </button>
    </>
  );
  const cls = 'flex items-center justify-between gap-4 rounded-lg border border-accent bg-surface p-4';
  const role = live ? 'status' : undefined;

  // Under reduced motion the banner is static: no entrance animation.
  if (reduced) {
    return (
      <div role={role} className={cls}>
        {body}
      </div>
    );
  }
  return (
    <motion.div
      role={role}
      className={cls}
      initial={{ opacity: 0, y: -12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 300, damping: 22 }}
    >
      {body}
    </motion.div>
  );
}
