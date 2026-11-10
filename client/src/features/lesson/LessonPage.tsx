import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { LessonProgressView, LessonView } from '../../../../shared/types';
import { api, ApiError, isUnavailable } from '../../api/client';
import type { AssessmentStarted, LessonProgressResponse, LessonResponse, Rewards } from '../../api/types';
import { Button } from '../../ui/Button';
import { Celebration } from '../../ui/Celebration';
import type { CheckResult } from './InlineCheck';
import { SectionView } from './SectionView';

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

  if (lesson.data) return <LessonPlayer key={objective} lesson={lesson.data.lesson} progress={lesson.data.progress} />;

  if (lesson.isError) {
    const status = lesson.error instanceof ApiError ? lesson.error.status : 0;
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <h1 className="text-2xl font-semibold">Lesson</h1>
        <p role="alert">
          {status === 403 ? lesson.error.message : status === 404 ? "This lesson isn't available." : "Couldn't load this lesson."}
        </p>
        {status !== 403 && status !== 404 && <Button onClick={() => void lesson.refetch()}>Try again</Button>}
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

function LessonPlayer({ lesson, progress }: { lesson: LessonView; progress: LessonProgressView }) {
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
  const [saveFailed, setSaveFailed] = useState(false);
  const [celebration, setCelebration] = useState<{ xp: number } | null>(null);
  const [startingQuiz, setStartingQuiz] = useState(false);
  const [quizError, setQuizError] = useState('');

  const heading = useRef<HTMLHeadingElement>(null);
  const celebrationBox = useRef<HTMLDivElement>(null);
  const hintId = useId();

  // On a new section, focus goes to its heading: the button that was pressed may be gone or stale.
  const shown = useRef(index);
  useEffect(() => {
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

  const section = sections[index];
  const checks = section?.blocks.flatMap((b) => (b.kind === 'check' ? [b.question.id] : [])) ?? [];
  // A section the server already has as done never holds the learner back, so a reload (which forgets
  // the marked checks) cannot trap anyone. In a section that is not done yet the checks are answered again;
  // the server accepts a repeated answer and marks it afresh.
  const blocked = section !== undefined && !done.has(section.id) && checks.some((id) => !results[id]);

  async function advance() {
    if (!section || saving) return;
    if (!done.has(section.id)) {
      setSaving(true);
      try {
        const saved = await api.post<LessonProgressResponse>(`${lessonUrl}/progress`, { sectionId: section.id });
        setDone(new Set(saved.sectionsDone));
        if (saved.completedAt && !completed) {
          setCompleted(true);
          setCelebration({ xp: saved.xp });
        }
        earned(saved);
      } catch {
        // Not saved: stay on this section rather than advance as if it had been.
        setSaveFailed(true);
        return;
      } finally {
        setSaving(false);
      }
    }
    setSaveFailed(false);
    setIndex(index + 1);
  }

  function go(to: number) {
    setSaveFailed(false);
    setIndex(to);
  }

  async function startQuiz() {
    if (startingQuiz) return;
    setStartingQuiz(true);
    setQuizError('');
    try {
      const { id } = await api.post<AssessmentStarted>('assessments', { kind: 'objective', scope: lesson.objective });
      navigate(`/quiz/${id}`);
    } catch (err) {
      setQuizError(isUnavailable(err) ? "Can't reach the server. Try again in a moment." : "Couldn't start the quiz. Try again.");
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
        <h1 className="text-2xl font-semibold">{lesson.title}</h1>
        <div className="space-y-1">
          <div
            role="progressbar"
            aria-label="Lesson progress"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={done.size}
            aria-valuetext={`${done.size} of ${total} sections complete`}
            className="h-2 overflow-hidden rounded-full bg-border"
          >
            <div className="h-full bg-accent transition-[width] duration-500" style={{ width: `${(done.size / total) * 100}%` }} />
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
            }}
          />
          <div className="space-y-3 border-t border-border pt-4">
            {saveFailed && (
              <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-bad">
                <p>Couldn't save your progress. You are still on this section.</p>
                <Button variant="secondary" onClick={() => void advance()}>
                  Try again
                </Button>
              </div>
            )}
            {blocked && (
              <p id={hintId} className="text-sm text-muted">
                {checks.length === 1 ? 'Answer the question above to continue.' : 'Answer each question above to continue.'}
              </p>
            )}
            <div role="group" aria-label="Lesson sections" className="flex flex-wrap justify-between gap-3">
              {index > 0 ? (
                <Button variant="secondary" onClick={() => go(index - 1)}>
                  Previous
                </Button>
              ) : (
                <span />
              )}
              <Button disabled={blocked} aria-describedby={blocked ? hintId : undefined} onClick={() => void advance()}>
                {index === total - 1 ? 'Finish lesson' : 'Next'}
              </Button>
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
                kind="streak"
                title="Lesson complete"
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
            <Button onClick={() => void startQuiz()}>Take the quiz</Button>
            <Button variant="secondary" onClick={() => go(0)}>
              Read the lesson again
            </Button>
          </div>
          <p>{pathLink}</p>
        </section>
      )}
    </article>
  );
}
