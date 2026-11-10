import { useQuery } from '@tanstack/react-query';
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { Answer, Feedback, PublicQuestion } from '../../../../shared/types';
import { api } from '../../api/client';
import type { AssessmentKind, AssessmentResult, PathResponse, Tally } from '../../api/types';
import { Celebration } from '../../ui/Celebration';
import { MasteryBar } from '../../ui/MasteryBar';
import { Mark } from '../questions/FeedbackPanel';
import { QuestionView } from '../questions/QuestionView';

const PASS_MARK: Record<AssessmentKind, string> = { objective: '80%', domain: '75%', mock: '750' };
const SCALE_MAX = 900;

const RING_SIZE = 152;
const RING_STROKE = 12;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/** The score as an arc that fills from empty when the screen opens; under reduced motion it is drawn full at once. */
function ScoreRing({ fraction, label, children }: { fraction: number; label: string; children: ReactNode }) {
  const reduced = useReducedMotion();
  const filled = RING_LENGTH * (1 - Math.max(0, Math.min(1, fraction)));
  const arc = {
    cx: RING_SIZE / 2,
    cy: RING_SIZE / 2,
    r: RING_RADIUS,
    fill: 'none',
    stroke: 'var(--accent)',
    strokeWidth: RING_STROKE,
    strokeLinecap: 'round' as const,
    strokeDasharray: RING_LENGTH,
  };
  return (
    <div role="img" aria-label={label} className="relative shrink-0" style={{ width: RING_SIZE, height: RING_SIZE }}>
      <svg width={RING_SIZE} height={RING_SIZE} aria-hidden="true" className="-rotate-90">
        <circle cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RING_RADIUS} fill="none" stroke="var(--border)" strokeWidth={RING_STROKE} />
        {reduced ? (
          <circle {...arc} strokeDashoffset={filled} />
        ) : (
          <motion.circle
            {...arc}
            initial={{ strokeDashoffset: RING_LENGTH }}
            animate={{ strokeDashoffset: filled }}
            transition={{ duration: 0.9, ease: 'easeOut' }}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  );
}

/** One bar per domain or objective. Left out when there is a single entry: that bar would repeat the score. */
function Breakdown({ heading, tally, label }: { heading: string; tally: Tally; label(key: string): string }) {
  const headingId = useId();
  const keys = Object.keys(tally).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (keys.length < 2) return null;
  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <h2 id={headingId} className="text-lg font-semibold">
        {heading}
      </h2>
      <div className="space-y-3">
        {keys.map((key) => {
          const { correct, total } = tally[key]!;
          return <MasteryBar key={key} value={total === 0 ? 0 : (correct / total) * 100} label={`${label(key)}: ${correct} of ${total} correct`} />;
        })}
      </div>
    </section>
  );
}

const ignore = () => {};

/** One question of the review list. The question itself is only drawn while its row is open. */
function ReviewItem({ number, question, answer, feedback }: { number: number; question: PublicQuestion; answer?: Answer; feedback: Feedback }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <li className="rounded-lg border border-border bg-surface">
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          onClick={() => setOpen(!open)}
          className="flex w-full items-start gap-3 rounded-lg p-4 text-left hover:bg-border/40"
        >
          <span className="min-w-0 flex-1 space-y-1">
            <span className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-semibold">{`Question ${number}: `}</span>
              <Mark ok={feedback.correct}>{feedback.correct ? 'Correct' : answer ? 'Incorrect' : 'Not answered'}</Mark>
            </span>
            {!open && <span className="block truncate text-sm text-muted">{question.prompt}</span>}
          </span>
          <span aria-hidden="true" className="font-mono text-muted">
            {open ? '−' : '+'}
          </span>
        </button>
      </h3>
      {open && (
        <div id={panelId} className="border-t border-border p-4">
          <QuestionView question={question} value={answer ?? null} onChange={ignore} feedback={feedback} />
        </div>
      )}
    </li>
  );
}

/**
 * The outcome of a finalized quiz or exam: score, pass or not, where the marks were lost, and every
 * question with the learner's answer and the feedback.
 */
export function ResultsView({
  result,
  questions,
  answers,
  feedback,
  title = 'Results',
  kind,
  partial = false,
  fresh = false,
  passTitle = title,
  children,
}: {
  result: AssessmentResult;
  questions: PublicQuestion[];
  answers: Record<string, Answer>;
  feedback: Record<string, Feedback>;
  title?: string;
  /** Names the pass mark. A result with a scaled score is shown as a mock exam whatever this says. */
  kind?: AssessmentKind;
  /** A mock exam that did not cover all five domains. */
  partial?: boolean;
  /** The assessment was finalized during this visit: the heading takes focus, and a pass is celebrated. */
  fresh?: boolean;
  /** The line the celebration of a pass carries. */
  passTitle?: string;
  /** What the learner can do next. */
  children?: ReactNode;
}) {
  const [missedOnly, setMissedOnly] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const celebrating = fresh && result.passed && !dismissed;
  const heading = useRef<HTMLHeadingElement>(null);
  const celebrationBox = useRef<HTMLDivElement>(null);
  const reviewId = useId();
  // Titles for the bars. Optional: without them the bars are named by number alone. Titles do not change,
  // so a path that is already in the cache is not read again for them.
  const path = useQuery({
    queryKey: ['path'],
    queryFn: () => api.get<PathResponse>('path'),
    staleTime: Infinity,
    throwOnError: false,
  });

  useEffect(() => {
    if (fresh) heading.current?.focus();
  }, [fresh]);

  const scaled = result.scaledScore;
  const percent = Math.floor(result.scorePct); // never rounded up to a pass mark that was missed
  const marked = questions.flatMap((question, i) => {
    const fb = feedback[question.id];
    return fb ? [{ number: i + 1, question, feedback: fb }] : [];
  });
  const correct = marked.filter((m) => m.feedback.correct).length;
  const shown = missedOnly ? marked.filter((m) => !m.feedback.correct) : marked;

  const domainLabel = (id: string) => {
    const found = path.data?.domains.find((d) => String(d.id) === id);
    return found ? `Domain ${id}: ${found.title}` : `Domain ${id}`;
  };
  const objectiveLabel = (id: string) => {
    const found = path.data?.domains.flatMap((d) => d.objectives).find((o) => o.id === id);
    return found ? `${id} ${found.title}` : `Objective ${id}`;
  };

  function dismissCelebration() {
    // Its Dismiss button goes with it; do not let focus fall back to the top of the page.
    if (celebrationBox.current?.contains(document.activeElement)) heading.current?.focus();
    setDismissed(true);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold">
        {title}
      </h1>

      {celebrating && (
        <div ref={celebrationBox}>
          <Celebration
            kind={kind === 'objective' ? 'quiz-pass' : 'exam-pass'}
            title={passTitle}
            detail={result.xp > 0 ? `+${result.xp} XP` : undefined}
            onDone={dismissCelebration}
          />
        </div>
      )}

      <section aria-label="Score" className="flex flex-wrap items-center gap-6">
        {scaled !== undefined ? (
          <ScoreRing fraction={result.scorePct / 100} label={`Estimated scaled score: ${scaled} out of ${SCALE_MAX}`}>
            <span className="font-mono text-3xl font-semibold">{scaled}</span>
            <span className="text-xs text-muted">{`of ${SCALE_MAX}`}</span>
          </ScoreRing>
        ) : (
          <ScoreRing fraction={result.scorePct / 100} label={`Score: ${percent}%`}>
            <span className="font-mono text-3xl font-semibold">{`${percent}%`}</span>
          </ScoreRing>
        )}
        <div className="min-w-0 flex-1 basis-60 space-y-2">
          <p className={`text-2xl font-semibold ${result.passed ? 'text-ok' : 'text-warn'}`}>
            <span aria-hidden="true">{result.passed ? '✓ ' : '○ '}</span>
            <span>{result.passed ? 'Passed' : 'Not yet'}</span>
          </p>
          <p>{`${correct} of ${marked.length} correct`}</p>
          {scaled !== undefined ? (
            <p className="text-sm text-muted">
              {`Estimated scaled score on the 100 to ${SCALE_MAX} scale. Pass mark: ${PASS_MARK.mock}. It is an estimate: CompTIA does not publish its scaling.`}
            </p>
          ) : (
            kind && <p className="text-sm text-muted">{`Pass mark: ${PASS_MARK[kind]}.`}</p>
          )}
          {partial && (
            <p className="text-sm text-muted">
              Partial practice exam: it did not cover all five domains, so the score says less than a full exam would.
            </p>
          )}
          <p className="font-mono text-sm">{`XP earned: ${result.xp}`}</p>
        </div>
      </section>

      {children && <div className="flex flex-wrap items-center gap-x-4 gap-y-3">{children}</div>}

      <Breakdown heading="By domain" tally={result.byDomain} label={domainLabel} />
      <Breakdown heading="By objective" tally={result.byObjective} label={objectiveLabel} />

      <section aria-labelledby={reviewId} className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id={reviewId} className="text-lg font-semibold">
            Review your answers
          </h2>
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-accent" checked={missedOnly} onChange={(e) => setMissedOnly(e.target.checked)} />
            <span>Missed only</span>
          </label>
        </div>
        <p role="status" className="text-sm text-muted">
          {`Showing ${shown.length} of ${marked.length} questions`}
        </p>
        {/* role="list" keeps the list semantics that Safari drops when list markers are removed. */}
        <ol role="list" aria-label="Questions" className="space-y-2">
          {shown.map((m) => (
            <ReviewItem key={m.question.id} number={m.number} question={m.question} answer={answers[m.question.id]} feedback={m.feedback} />
          ))}
        </ol>
      </section>
    </div>
  );
}
