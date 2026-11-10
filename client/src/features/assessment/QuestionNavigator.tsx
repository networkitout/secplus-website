import type { PublicQuestion } from '../../../../shared/types';

export function FlagIcon({ filled = false }: { filled?: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false" className="inline-block shrink-0">
      <path d="M3.5 1.5v13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M3.5 2.5h9l-2.2 3 2.2 3h-9z" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * The exam's question grid. Each number is a button whose name says its state in words; on screen an
 * answered question has a solid border and a tick, an unanswered one a dashed border, a flagged one a flag.
 */
export function QuestionNavigator({
  questions,
  current,
  answered,
  flagged,
  onSelect,
}: {
  questions: PublicQuestion[];
  /** Index of the question on screen. */
  current: number;
  answered: ReadonlySet<string>;
  flagged: ReadonlySet<string>;
  onSelect(index: number): void;
}) {
  const answeredCount = questions.filter((q) => answered.has(q.id)).length;
  const flaggedCount = questions.filter((q) => flagged.has(q.id)).length;

  return (
    <nav aria-label="Question navigator" className="space-y-3">
      <p className="text-sm text-muted">{`${answeredCount} of ${questions.length} answered, ${flaggedCount} flagged`}</p>
      <ol className="grid grid-cols-[repeat(auto-fill,minmax(2.75rem,1fr))] gap-2">
        {questions.map((q, i) => {
          const isAnswered = answered.has(q.id);
          const isFlagged = flagged.has(q.id);
          return (
            <li key={q.id}>
              <button
                type="button"
                aria-label={`Question ${i + 1}, ${isAnswered ? 'answered' : 'unanswered'}${isFlagged ? ', flagged' : ''}`}
                aria-current={i === current ? 'true' : undefined}
                onClick={() => onSelect(i)}
                className={`relative flex h-11 w-full items-center justify-center rounded-md border font-mono text-sm hover:border-accent ${
                  isAnswered ? 'border-solid border-text bg-surface' : 'border-dashed border-muted text-muted'
                } ${i === current ? 'ring-2 ring-accent' : ''}`}
              >
                <span>{i + 1}</span>
                {isAnswered && <span className="absolute bottom-0 right-1 text-[0.65rem] text-ok">✓</span>}
                {isFlagged && (
                  <span className="absolute left-1 top-0.5 text-warn">
                    <FlagIcon filled />
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>
      <ul aria-hidden="true" className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <li>
          <span className="text-ok">✓</span> Answered
        </li>
        <li>
          <span className="mr-1 inline-block h-3 w-3 rounded-sm border border-dashed border-muted align-[-1px]" />
          Unanswered
        </li>
        <li>
          <span className="text-warn">
            <FlagIcon filled />
          </span>{' '}
          Flagged
        </li>
      </ul>
    </nav>
  );
}
