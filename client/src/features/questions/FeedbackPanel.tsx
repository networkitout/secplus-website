import type { ReactNode } from 'react';
import type { Feedback } from '../../../../shared/types';

/** Result marker: an icon plus a text label, so the outcome never depends on colour. */
export function Mark({ ok, muted = false, children }: { ok: boolean; muted?: boolean; children: ReactNode }) {
  const tone = muted ? 'text-muted' : ok ? 'text-ok' : 'text-bad';
  return (
    <span className={`inline-flex items-baseline gap-1.5 text-sm font-semibold ${tone}`}>
      <span aria-hidden="true">{ok ? '✓' : '✗'}</span>
      <span>{children}</span>
    </span>
  );
}

/** Marking shown under one option of a single- or multi-choice question, with the reason it is right or wrong. */
export function ChoiceFeedback({
  id,
  correct,
  chosen,
  why,
}: {
  id: string;
  correct: boolean;
  chosen: boolean;
  why?: string;
}) {
  const label = correct
    ? chosen ? 'Correct answer (your choice)' : 'Correct answer (not chosen)'
    : chosen ? 'Incorrect (your choice)' : 'Incorrect';
  return (
    <div id={id} className="mt-1 space-y-1 pl-7">
      <Mark ok={correct} muted={!correct && !chosen}>{label}</Mark>
      {why && <p className="text-sm text-muted">{why}</p>}
    </div>
  );
}

export function FeedbackPanel({ feedback }: { feedback: Feedback }) {
  return (
    <div className={`mt-4 rounded-lg border bg-surface p-4 ${feedback.correct ? 'border-ok' : 'border-bad'}`}>
      <p className={`text-base font-semibold ${feedback.correct ? 'text-ok' : 'text-bad'}`}>
        <span aria-hidden="true">{feedback.correct ? '✓' : '✗'}</span> {feedback.correct ? 'Correct' : 'Incorrect'}
      </p>
      <p className="mt-2 text-sm">{feedback.explanation}</p>
    </div>
  );
}
