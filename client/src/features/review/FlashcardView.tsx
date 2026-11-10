import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, type MouseEvent, type ReactNode } from 'react';
import { Button } from '../../ui/Button';

const FACE = 'col-start-1 row-start-1 flex min-h-56 flex-col items-center justify-center gap-3 rounded-xl border bg-surface p-6 text-center';
const EYEBROW = 'font-mono text-xs uppercase tracking-wide text-accent';

/** A key cap inside a button. Hidden from assistive technology: the button carries `aria-keyshortcuts`. */
function Key({ children }: { children: string }) {
  return (
    <span aria-hidden="true" className="ml-2 rounded border border-current px-1.5 font-mono text-xs opacity-80">
      {children}
    </span>
  );
}

/**
 * One flashcard: the term, then (once `definition` is given) the answer side and the two answers. It asks
 * for the definition with `onReveal` and reports the learner's answer with `onGrade`; the requests belong
 * to the caller, which must ignore a call while one is on its way.
 *
 * Shortcuts: Space or Enter shows the answer, 1 and 2 answer. They are also written on the page.
 */
export function FlashcardView({
  term,
  definition,
  locked = false,
  onReveal,
  onGrade,
  children,
}: {
  term: string;
  /** Null until it has been asked for and has arrived. Until then the answer side is empty. */
  definition: string | null;
  /** The card can no longer be shown or answered: the buttons and the shortcuts are off. */
  locked?: boolean;
  onReveal(): void;
  onGrade(knewIt: boolean): void;
  /** Messages about the card (a failed request, for example), shown between the card and its buttons. */
  children?: ReactNode;
}) {
  const reduced = useReducedMotion();
  const revealed = definition !== null;
  const answer = useRef<HTMLParagraphElement>(null);

  // Reading the answer is the next thing to do: focus goes to it (which also reads it out), and the two
  // answer buttons follow it in the tab order.
  useEffect(() => {
    if (revealed) answer.current?.focus();
  }, [revealed]);

  useEffect(() => {
    if (locked) return;
    function onKeyDown(e: KeyboardEvent) {
      // A held key repeats: it must not answer card after card.
      if (e.repeat || e.isComposing || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest('input, select, textarea, [contenteditable]:not([contenteditable="false"])')) return;
      if (e.key === '1' || e.key === '2') {
        if (!revealed) return;
        e.preventDefault();
        onGrade(e.key === '1');
      } else if (e.key === ' ' || e.key === 'Enter') {
        // A focused button or link keeps its own Space and Enter; on "Show answer" that is its click.
        if (revealed || target?.closest('button, a[href], summary, [role="button"], [role="link"]')) return;
        e.preventDefault();
        onReveal();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  });

  /** For a button: ignores the second click of a double click, which may land on a button that has just appeared. */
  const once = (action: () => void) => (e: MouseEvent) => {
    if (e.detail <= 1) action();
  };

  const front = (
    <>
      <p className={EYEBROW}>Term</p>
      <p className="text-2xl font-semibold">{term}</p>
    </>
  );
  // Nothing of the answer is in the page before it is asked for.
  const back = revealed && (
    <>
      <p className={EYEBROW}>{term}</p>
      <p ref={answer} tabIndex={-1} className="rounded-sm text-lg">
        {definition}
      </p>
    </>
  );

  return (
    <div className="space-y-4">
      {reduced ? (
        // No turning: the answer fades in over the term.
        <div role="group" aria-label="Flashcard" className="grid">
          <motion.div
            data-face="front"
            aria-hidden={revealed}
            className={`${FACE} border-border`}
            initial={false}
            animate={{ opacity: revealed ? 0 : 1 }}
            transition={{ duration: 0.25 }}
          >
            {front}
          </motion.div>
          <motion.div
            data-face="back"
            className={`${FACE} border-accent ${revealed ? '' : 'pointer-events-none'}`}
            initial={false}
            animate={{ opacity: revealed ? 1 : 0 }}
            transition={{ duration: 0.25 }}
          >
            {back}
          </motion.div>
        </div>
      ) : (
        <div role="group" aria-label="Flashcard" className="perspective-distant">
          <motion.div
            className="grid transform-3d"
            initial={false}
            animate={{ rotateY: revealed ? 180 : 0 }}
            transition={{ duration: 0.5, ease: 'easeInOut' }}
          >
            <div data-face="front" aria-hidden={revealed} className={`${FACE} border-border backface-hidden`}>
              {front}
            </div>
            <div data-face="back" className={`${FACE} rotate-y-180 border-accent backface-hidden`}>
              {back}
            </div>
          </motion.div>
        </div>
      )}

      {children}

      {!locked &&
        (revealed ? (
          <div className="space-y-2">
            <div role="group" aria-label="How did you do?" className="flex flex-wrap gap-3">
              <Button aria-keyshortcuts="1" onClick={once(() => onGrade(true))}>
                I knew it<Key>1</Key>
              </Button>
              <Button variant="secondary" aria-keyshortcuts="2" onClick={once(() => onGrade(false))}>
                I didn't<Key>2</Key>
              </Button>
            </div>
            <p className="text-sm text-muted">Press 1 for “I knew it”, press 2 for “I didn't”.</p>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Button aria-keyshortcuts="Space Enter" onClick={once(onReveal)}>
              Show answer
            </Button>
            <p className="text-sm text-muted">or press Space or Enter</p>
          </div>
        ))}
    </div>
  );
}
