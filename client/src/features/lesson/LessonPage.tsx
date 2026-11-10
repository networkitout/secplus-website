import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { LessonProgressView, LessonView } from '../../../../shared/types';
import { api, ApiError, isUnavailable } from '../../api/client';
import type { AssessmentStarted, LessonProgressResponse, LessonResponse, Rewards } from '../../api/types';
import { Button } from '../../ui/Button';
import { Celebration } from '../../ui/Celebration';
import type { CheckResult } from './InlineCheck';
import { SectionView } from './SectionView';
import { isTransient } from './transient';

/**
 * After the screen changes, presses on the lesson's own buttons are ignored for this long. A double click
 * or double tap, or a held Enter key, sends its second press when the next screen may already be showing;
 * without the pause that press would move on (or start the quiz) unseen. A time window is used because it
 * works the same for mouse, touch and keyboard: the click count in `event.detail` is 0 for the keyboard
 * and is not counted alike for touch in every browser.
 */
const SETTLE_MS = 500;

const pathLink = (
  <Link to="/" className="text-accent underline underline-offset-2">
    Back to the study path
  </Link>
);

export function LessonPage() {
  const { objective = '' } = useParams();
  // Always read from the server: where the learner resumes depends on progress saved by any device.
  const lesson = useQuery({
    queryKey: ['lesson', objective],
    queryFn: () => api.get<LessonResponse>(`lessons/${encodeURIComponent(objective)}`),
    staleTime: Infinity,
    gcTime: 0,
  });

  // The query forgets a failure as soon as it fetches again; remember the retry, so that "Try again" stays
  // where it is (and keeps keyboard focus) until the answer arrives. It is remembered for one objective:
  // when the address changes to another lesson, that lesson starts without it.
  const [retried, setRetried] = useState<{ objective: string; pending: boolean } | null>(null);
  const mine = retried?.objective === objective ? retried : null;
  const retrying = mine?.pending === true;

  if (lesson.data) {
    // After a retry the pressed button is gone, so the player takes keyboard focus (see `takeFocus`).
    return <LessonPlayer key={objective} lesson={lesson.data.lesson} progress={lesson.data.progress} takeFocus={mine !== null} />;
  }

  if (lesson.isError || retrying) {
    const status = lesson.error instanceof ApiError ? lesson.error.status : 0;
    const final = status === 403 || status === 404;
    const retry = () => {
      if (retrying) return;
      setRetried({ objective, pending: true });
      void lesson.refetch().finally(() => setRetried((r) => (r?.objective === objective ? { objective, pending: false } : r)));
    };
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <h1 className="text-2xl font-semibold">Lesson</h1>
        {lesson.isError && (
          <p role="alert">{status === 403 ? lesson.error.message : status === 404 ? "This lesson isn't available." : "Couldn't load this lesson."}</p>
        )}
        {!final && (
          <div className="flex flex-wrap items-center gap-3">
            <Button aria-busy={retrying} onClick={retry}>
              Try again
            </Button>
            <p role="status" className="text-sm text-muted">
              {retrying ? 'Loading lesson…' : ''}
            </p>
          </div>
        )}
        <p>{pathLink}</p>
      </div>
    );
  }

  return (
    <p role="status" className="text-muted">
      Loading lesson…
    </p>
  );
}

function LessonPlayer({
  lesson,
  progress,
  takeFocus = false,
}: {
  lesson: LessonView;
  progress: LessonProgressView;
  /** Put focus on the lesson title when the player appears, unless something else already has it. */
  takeFocus?: boolean;
}) {
  const { sections } = lesson;
  const total = sections.length;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const lessonUrl = `lessons/${encodeURIComponent(lesson.objective)}`;

  const [done, setDone] = useState(() => new Set(progress.sectionsDone));
  const [completed, setCompleted] = useState(progress.completedAt !== null);
  // `total` is the end screen.
  const [index, setIndex] = useState(() => {
    const first = sections.findIndex((s) => !progress.sectionsDone.includes(s.id));
    return first === -1 ? total : first;
  });
  // Marked checks live here, so they survive moving between sections. The server does not report them
  // after a reload; see `blocked` below.
  const [results, setResults] = useState<Record<string, CheckResult>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<'retry' | 'reload' | null>(null);
  const [celebration, setCelebration] = useState<{ xp: number } | null>(null);
  const [startingQuiz, setStartingQuiz] = useState(false);
  const [quizError, setQuizError] = useState('');

  const title = useRef<HTMLHeadingElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const celebrationBox = useRef<HTMLDivElement>(null);
  const hintId = useId();

  // Read by the button handlers. Refs, not state, so that a press always sees the current values, even one
  // that is handled before the next render.
  const busy = useRef(false);
  const changedAt = useRef<number | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // The lesson was loaded by "Try again", and that button went away with the error screen. Focus would
  // otherwise fall back to the document; it is not taken from anything the learner has moved it to.
  useLayoutEffect(() => {
    if (takeFocus && (document.activeElement === null || document.activeElement === document.body)) title.current?.focus();
    // Only when the player first appears, so there are no dependencies.
  }, []);

  /** False while a request of this screen is on its way, and for a moment after the screen changed. */
  function ready(): boolean {
    return !busy.current && (changedAt.current === null || performance.now() - changedAt.current >= SETTLE_MS);
  }

  function show(to: number) {
    changedAt.current = performance.now();
    setSaveError(null);
    setIndex(to);
  }

  // On a new section, focus goes to its heading: the button that was pressed may be gone or stale. A layout
  // effect, so that focus has left the button before the browser delivers another key press.
  const shown = useRef(index);
  useLayoutEffect(() => {
    if (shown.current === index) return;
    shown.current = index;
    heading.current?.focus();
  }, [index]);

  /**
   * XP and badges from an answer or a finished lesson arrive here. Task 20's rewards provider takes them
   * over; until then the header re-reads its totals.
   */
  function earned({ xp, newBadges }: Rewards) {
    if (xp > 0 || newBadges.length > 0) void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  }

  /**
   * A saved section changes the study path: fetch it again now (the query is not on screen, so a plain
   * invalidation would wait), so that the map is current when the learner returns.
   */
  function refreshPath() {
    void queryClient.invalidateQueries({ queryKey: ['path'], refetchType: 'all' });
  }

  const section = sections[index];
  const doneCount = sections.filter((s) => done.has(s.id)).length;
  const checks = section?.blocks.flatMap((b) => (b.kind === 'check' ? [b.question.id] : [])) ?? [];
  // A section the server already has as done never holds the learner back, so a reload (which forgets
  // the marked checks) cannot trap anyone. In a section that is not done yet the checks are answered again;
  // the server accepts a repeated answer and marks it afresh.
  const blocked = section !== undefined && !done.has(section.id) && checks.some((id) => !results[id]);

  async function advance() {
    if (!section || !ready()) return;
    if (!done.has(section.id)) {
      busy.current = true;
      setSaving(true);
      try {
        const saved = await api.post<LessonProgressResponse>(`${lessonUrl}/progress`, { sectionId: section.id });
        setDone(new Set(saved.sectionsDone));
        if (saved.completedAt && !completed) {
          setCompleted(true);
          setCelebration({ xp: saved.xp });
        }
        earned(saved);
        refreshPath();
      } catch (err) {
        // Not saved: stay on this section rather than advance as if it had been. Only a failure that can
        // pass (no connection, server busy) gets a retry; anything else means the lesson has changed.
        setSaveError(isTransient(err) ? 'retry' : 'reload');
        return;
      } finally {
        busy.current = false;
        setSaving(false);
      }
    }
    // Nothing else can have changed the section meanwhile: every control checks `ready()` first.
    show(index + 1);
  }

  function go(to: number) {
    if (ready()) show(to);
  }

  async function startQuiz() {
    if (!ready()) return;
    busy.current = true;
    setStartingQuiz(true);
    setQuizError('');
    try {
      const { id } = await api.post<AssessmentStarted>('assessments', { kind: 'objective', scope: lesson.objective });
      // Not if the learner has gone to another page meanwhile.
      if (mounted.current) navigate(`/quiz/${id}`);
    } catch (err) {
      setQuizError(isUnavailable(err) ? "Can't reach the server. Try again in a moment." : "Couldn't start the quiz. Try again.");
      busy.current = false;
      setStartingQuiz(false);
    }
  }

  function dismissCelebration() {
    // Its Dismiss button goes with it; do not let focus fall back to the top of the page.
    if (celebrationBox.current?.contains(document.activeElement)) heading.current?.focus();
    setCelebration(null);
  }

  return (
    <article className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-3">
        <p className="font-mono text-sm text-muted">{`Objective ${lesson.objective} · about ${lesson.minutes} min`}</p>
        <h1 ref={title} tabIndex={-1} className="text-2xl font-semibold">
          {lesson.title}
        </h1>
        <div className="space-y-1">
          <div
            role="progressbar"
            aria-label="Lesson progress"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={doneCount}
            aria-valuetext={`${doneCount} of ${total} sections complete`}
            className="h-2 overflow-hidden rounded-full bg-border"
          >
            <div className="h-full bg-accent transition-[width] duration-500" style={{ width: `${(doneCount / total) * 100}%` }} />
          </div>
          <p className="text-sm text-muted">{section ? `Section ${index + 1} of ${total}` : `${total} of ${total} sections read`}</p>
        </div>
      </header>

      {section ? (
        <>
          <SectionView
            key={section.id}
            section={section}
            headingRef={heading}
            results={results}
            onAnswered={(questionId, { answer, feedback, xp, newBadges }) => {
              setResults((r) => ({ ...r, [questionId]: { answer, feedback } }));
              earned({ xp, newBadges });
              // An answer changes mastery on the study path. Marking it out of date is enough: it is fetched
              // when the learner next opens the path, or with the next saved section.
              void queryClient.invalidateQueries({ queryKey: ['path'] });
            }}
          />
          <div className="space-y-3 border-t border-border pt-4">
            {saveError === 'retry' && (
              <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-bad">
                <p>Couldn't save your progress. You are still on this section.</p>
                <Button variant="secondary" aria-busy={saving} onClick={() => void advance()}>
                  Try again
                </Button>
              </div>
            )}
            {saveError === 'reload' && (
              <p role="alert" className="text-sm text-bad">
                Couldn't save your progress. This lesson may have changed since you opened it: reload the page to continue.
              </p>
            )}
            {blocked && (
              <p id={hintId} className="text-sm text-muted">
                {checks.length === 1 ? 'Answer the question above to continue.' : 'Answer each question above to continue.'}
              </p>
            )}
            <div role="group" aria-label="Lesson sections" className="flex flex-wrap items-center justify-between gap-3">
              {index > 0 ? (
                <Button variant="secondary" onClick={() => go(index - 1)}>
                  Previous
                </Button>
              ) : (
                <span />
              )}
              <div className="flex items-center gap-3">
                <p role="status" className="text-sm text-muted">
                  {saving ? 'Saving your progress…' : ''}
                </p>
                {/* Never disabled while saving: a disabled button would drop keyboard focus. */}
                <Button disabled={blocked} aria-busy={saving} aria-describedby={blocked ? hintId : undefined} onClick={() => void advance()}>
                  {index === total - 1 ? 'Finish lesson' : 'Next'}
                </Button>
              </div>
            </div>
          </div>
        </>
      ) : (
        <section className="space-y-5">
          <h2 ref={heading} tabIndex={-1} className="text-xl font-semibold">
            You've finished this lesson
          </h2>
          {celebration && (
            <div ref={celebrationBox}>
              <Celebration
                kind="lesson"
                title={lesson.title}
                detail={celebration.xp > 0 ? `+${celebration.xp} XP` : undefined}
                onDone={dismissCelebration}
              />
            </div>
          )}
          <p>The quiz for this objective has 10 questions. Score 80% or more to pass it.</p>
          {quizError && (
            <p role="alert" className="text-sm text-bad">
              {quizError}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button aria-busy={startingQuiz} onClick={() => void startQuiz()}>
              Take the quiz
            </Button>
            <Button variant="secondary" onClick={() => go(0)}>
              Read the lesson again
            </Button>
            <p role="status" className="text-sm text-muted">
              {startingQuiz ? 'Starting the quiz…' : ''}
            </p>
          </div>
          <p>{pathLink}</p>
        </section>
      )}
    </article>
  );
}
