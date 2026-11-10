import type { MockHistoryEntry } from '../../api/types';
import { formatInstant } from '../../lib/dates';

const PASS_MARK = 750;
const MIN = 100;
const MAX = 900;
const GRID = [100, 300, 500, 700, 900];

// Drawing units. The chart is at most about one and a half times this wide, so its text stays readable.
const WIDTH = 300;
const HEIGHT = 190;
// To the right of the plot there is room for the label of the pass mark, clear of the line and the points.
const PLOT = { left: 34, right: 234, top: 16, bottom: 160 };
const FONT = 11;

const yOf = (score: number) => PLOT.bottom - ((Math.min(MAX, Math.max(MIN, score)) - MIN) / (MAX - MIN)) * (PLOT.bottom - PLOT.top);
/** Evenly spaced, oldest on the left; a single exam sits in the middle. */
const xOf = (i: number, n: number) => (n === 1 ? (PLOT.left + PLOT.right) / 2 : PLOT.left + (i / (n - 1)) * (PLOT.right - PLOT.left));

function Mark({ passed }: { passed: boolean }) {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false" className="inline-block shrink-0">
      <circle cx="6" cy="6" r="4" fill={passed ? 'var(--accent)' : 'var(--surface)'} stroke="var(--accent)" strokeWidth="2" />
    </svg>
  );
}

/**
 * The learner's finished mock exams (oldest first, at least one) as a line chart with the pass mark, and
 * the same scores as a table. The chart is one image to assistive technology; the table carries the data.
 */
export function MockHistoryChart({ mocks, timeZone }: { mocks: MockHistoryEntry[]; timeZone: string }) {
  const n = mocks.length;
  const points = mocks.map((m, i) => ({ x: xOf(i, n), y: yOf(m.scaledScore), passed: m.passed, id: m.id }));
  const first = mocks[0];
  const last = mocks[n - 1];
  const passY = yOf(PASS_MARK);
  const newestFirst = [...mocks].reverse();

  return (
    <div className="space-y-4">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`Line chart of your ${n} practice exam ${n === 1 ? 'score' : 'scores'}, with the pass mark at ${PASS_MARK}. The table after it lists every score.`}
        className="w-full max-w-md"
        fontSize={FONT}
      >
        {GRID.map((score) => (
          <g key={score}>
            <line data-grid={score} x1={PLOT.left} x2={PLOT.right} y1={yOf(score)} y2={yOf(score)} stroke="var(--border)" strokeWidth="1" />
            <text x={PLOT.left - 6} y={yOf(score) + FONT / 3} textAnchor="end" fill="var(--muted)">
              {score}
            </text>
          </g>
        ))}
        <line x1={PLOT.left} x2={PLOT.right} y1={passY} y2={passY} stroke="var(--warn)" strokeWidth="1.5" strokeDasharray="6 4" />
        <text x={PLOT.right + 8} y={passY - 2} fill="var(--text)">
          <tspan>{'Pass mark '}</tspan>
          <tspan x={PLOT.right + 8} dy={FONT + 1}>
            {PASS_MARK}
          </tspan>
        </text>
        {n > 1 && <polyline points={points.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="var(--accent)" strokeWidth="2" />}
        {points.map((p) => (
          <circle key={p.id} data-point="" cx={p.x} cy={p.y} r="4" fill={p.passed ? 'var(--accent)' : 'var(--surface)'} stroke="var(--accent)" strokeWidth="2" />
        ))}
        {first && (
          <text x={n === 1 ? xOf(0, 1) : PLOT.left} y={PLOT.bottom + 20} textAnchor={n === 1 ? 'middle' : 'start'} fill="var(--muted)">
            {formatInstant(first.submittedAt, timeZone)}
          </text>
        )}
        {n > 1 && last && (
          <text x={PLOT.right} y={PLOT.bottom + 20} textAnchor="end" fill="var(--muted)">
            {formatInstant(last.submittedAt, timeZone)}
          </text>
        )}
      </svg>
      <ul role="list" className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
        <li className="inline-flex items-center gap-1.5">
          <Mark passed />
          Passed
        </li>
        <li className="inline-flex items-center gap-1.5">
          <Mark passed={false} />
          Not passed
        </li>
        <li className="inline-flex items-center gap-1.5">
          <svg viewBox="0 0 24 12" width="24" height="12" aria-hidden="true" focusable="false" className="inline-block shrink-0">
            <line x1="0" x2="24" y1="6" y2="6" stroke="var(--warn)" strokeWidth="2" strokeDasharray="6 4" />
          </svg>
          {`Pass mark (${PASS_MARK})`}
        </li>
      </ul>
      {mocks.some((m) => m.partial) && (
        <p className="text-sm text-muted">
          A partial practice exam covers only the domains that have content. It does not count toward exam readiness.
        </p>
      )}
      <table className="w-full max-w-md text-left text-sm">
        <caption className="pb-2 text-left text-muted">Practice exam scores, newest first</caption>
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className="py-2 pr-3 font-medium">Date</th>
            <th scope="col" className="py-2 pr-3 font-medium">Score (estimate)</th>
            <th scope="col" className="py-2 pr-3 font-medium">Result</th>
            <th scope="col" className="py-2 font-medium">Coverage</th>
          </tr>
        </thead>
        <tbody>
          {newestFirst.map((m) => (
            <tr key={m.id} className="border-b border-border">
              <td className="py-2 pr-3">
                <time dateTime={m.submittedAt}>{formatInstant(m.submittedAt, timeZone)}</time>
              </td>
              <td className="py-2 pr-3 font-mono">{m.scaledScore}</td>
              <td className="py-2 pr-3">{m.passed ? 'Passed' : 'Not passed'}</td>
              <td className="py-2">{m.partial ? 'Partial' : 'All domains'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
