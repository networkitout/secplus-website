import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { Button } from '../../ui/Button';
import { usePressGuard } from '../../ui/pressGuard';

const FACE = 'col-start-1 row-start-1 flex min-h-56 flex-col items-center justify-center gap-3 rounded-xl border bg-surface p-6 text-center';
const EYEBROW = 'font-mono text-xs uppercase tracking-wide text-accent';
// A button with a request on its way stays focusable (a disabled one would drop keyboard focus) and says so.
const WAITING = 'aria-disabled:cursor-progress aria-disabled:opacity-60';
const TEXT_ENTRY = 'input, select, textarea, [contenteditable]:not([contenteditable="false"])';

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
 * to the caller, which tells the card through `busy` while one is on its way.
 *
 * Shortcuts: Space or Enter shows the answer, 1 and 2 answer. They are also written on the page. They act
 * on keys pressed inside `scope` (by default the card itself) or on the page around it, never on a key
 * pressed with focus on a control elsewhere.
 *
 * A press or a key that arrives straight after the answer appeared does not grade (see `usePressGuard`):
 * a second tap on "Show answer" would otherwise land on "I knew it". Showing the answer is not held back,
 * not on a card that has only just appeared either: it grades nothing, and a learner who grades one card
 * and knows the next term at a glance presses Space within half a second.
 */
export function FlashcardView({
  term,
  definition,
  locked = false,
  busy = null,
  scope,
  onReveal,
  onGrade,
  children,
}: {
  term: string;
  /** Null until it has been asked for and has arrived. Until then the answer side is empty. */
  definition: string | null;
  /** The card can no longer be shown or answered: the buttons and the shortcuts are off. */
  locked?: boolean;
  /** The request that is on its way, if any: its button says so, and nothing else is asked meanwhile. */
  busy?: 'reveal' | 'grade' | null;
  /** The part of the page the card belongs to, when it is more than the card (its heading, for example). */
  scope?: RefObject<HTMLElement | null>;
  onReveal(): void;
  onGrade(knewIt: boolean): void;
  /** Messages about the card (a failed request, for example), shown between the card and its buttons. */
  children?: ReactNode;
}) {
  const reduced = useReducedMotion();
  const revealed = definition !== null;
  const answer = useRef<HTMLParagraphElement>(null);
  const root = useRef<HTMLDivElement>(null);
  // The buttons and the shortcut keys both come through here, so the pause is the same for both. It begins
  // when the answer appears, and holds the grades back.
  const guard = usePressGuard(revealed);
  const reveal = () => {
    if (!busy) onReveal();
  };
  const grade = (knewIt: boolean) => {
    if (!busy && guard.settled()) onGrade(knewIt);
  };

  // Reading the answer is the next thing to do: focus goes to it (which also reads it out), and the two
  // answer buttons follow it in the tab order.
  useEffect(() => {
    if (revealed) answer.current?.focus();
  }, [revealed]);

  useEffect(() => {
    if (locked) return;
    function onKeyDown(e: KeyboardEvent) {
      // A key that something else has dealt with, and a held key that repeats, are not answers.
      if (e.defaultPrevented || e.repeat || e.isComposing || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      const area = scope?.current ?? root.current;
      if (!target || !area) return;
      // Only a key pressed with focus inside the card, or on the page around it (the body, or a container
      // the card sits in), is about the card. Focus on a link or a button elsewhere is not.
      if (!area.contains(target) && !target.contains(area)) return;
      if (target.closest(TEXT_ENTRY)) return;
      if (e.key === '1' || e.key === '2') {
        if (!revealed) return;
        e.preventDefault();
        grade(e.key === '1');
      } else if (e.key === ' ' || e.key === 'Enter') {
        // Whatever can be reached with Tab keeps its own Space and Enter; on "Show answer" that is its click.
        if (revealed || target.tabIndex >= 0) return;
        e.preventDefault();
        reveal();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  });

  const front = (
    <>
      <p className={EYEBROW}>Term</p>
      <p className="text-2xl font-semibold [overflow-wrap:anywhere]">{term}</p>
    </>
  );
  // Nothing of the answer is in the page before it is asked for.
  const back = revealed && (
    <>
      <p className={`${EYEBROW} [overflow-wrap:anywhere]`}>{term}</p>
      <p ref={answer} tabIndex={-1} className="rounded-sm text-lg">
        {definition}
      </p>
    </>
  );

  return (
    <div ref={root} className="space-y-4">
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
      <p role="status" aria-label="Card activity" className="sr-only">
        {busy === 'reveal' ? 'Loading the answer…' : busy === 'grade' ? 'Saving your answer…' : ''}
      </p>

      {!locked &&
        (revealed ? (
          <div className="space-y-2">
            <div role="group" aria-label="How did you do?" className="flex flex-wrap gap-3">
              <Button aria-keyshortcuts="1" aria-disabled={busy !== null} className={WAITING} onClick={() => grade(true)}>
                I knew it<Key>1</Key>
              </Button>
              <Button
                variant="secondary"
                aria-keyshortcuts="2"
                aria-disabled={busy !== null}
                className={WAITING}
                onClick={() => grade(false)}
              >
                I didn't<Key>2</Key>
              </Button>
            </div>
            <p className="text-sm text-muted">Press 1 for “I knew it”, press 2 for “I didn't”.</p>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Button aria-keyshortcuts="Space Enter" aria-disabled={busy !== null} className={WAITING} onClick={reveal}>
              {busy === 'reveal' ? 'Loading the answer…' : 'Show answer'}
            </Button>
            <p className="text-sm text-muted">or press Space or Enter</p>
          </div>
        ))}
    </div>
  );
}
