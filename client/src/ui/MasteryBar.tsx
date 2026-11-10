import { wholePercent } from '../lib/percent';

export function MasteryBar({ value, label }: { value: number; label: string }) {
  // Rounded down, like a score: a bar never reads as more than was reached.
  const v = Math.max(0, Math.min(100, wholePercent(value)));
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span>{label}</span>
        <span className="font-mono text-muted">{v}%</span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuenow={v}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-2 overflow-hidden rounded-full bg-border"
      >
        <div className="h-full bg-accent transition-[width] duration-500" style={{ width: `${v}%` }} />
      </div>
    </div>
  );
}
