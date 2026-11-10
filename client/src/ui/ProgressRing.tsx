const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));

export function ProgressRing({ value, size = 96, label }: { value: number; size?: number; label: string }) {
  const v = clamp(value);
  const stroke = Math.max(6, Math.round(size / 10));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={v}
      aria-valuemin={0}
      aria-valuemax={100}
      className="relative inline-block"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} aria-hidden="true" className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v / 100)}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-mono text-sm">{v}%</span>
    </div>
  );
}
