import type { ReactNode } from 'react';

/** Every diagram is drawn on a canvas this many units wide, so text stays legible on a 360 px screen. */
export const WIDTH = 320;

/** How much a part stands out in the current step. */
export type Emphasis = 'on' | 'off' | 'dim' | 'hidden';

export type Point = readonly [x: number, y: number];

// `dim` keeps text above a 4.5:1 contrast ratio in both themes.
const OPACITY: Record<Emphasis, number> = { on: 1, off: 1, dim: 0.65, hidden: 0 };

// Only these properties change between steps. The global stylesheet makes the change instant when the
// system asks for reduced motion.
const EASE = 'transition-[opacity,stroke,stroke-width] duration-300 ease-out';

const line = (state: Emphasis) => (state === 'on' ? 'var(--accent)' : 'var(--muted)');

const TONE = { text: 'var(--text)', muted: 'var(--muted)', accent: 'var(--accent)' } as const;

export function Canvas({ height, children }: { height: number; children: ReactNode }) {
  return (
    <svg viewBox={`0 0 ${WIDTH} ${height}`} className="block h-auto w-full" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

/** A group of parts that fades with the step. */
export function Layer({ state, children }: { state: Emphasis; children: ReactNode }) {
  return (
    <g className={EASE} style={{ opacity: OPACITY[state] }}>
      {children}
    </g>
  );
}

/** Lines of text. `y` is the middle of the first line. */
export function Label({
  x,
  y,
  lines,
  size = 10,
  anchor = 'middle',
  tone = 'text',
  bold = false,
  mono = false,
}: {
  x: number;
  y: number;
  lines: readonly string[];
  size?: number;
  anchor?: 'start' | 'middle' | 'end';
  tone?: keyof typeof TONE;
  bold?: boolean;
  mono?: boolean;
}) {
  return (
    <text
      textAnchor={anchor}
      dominantBaseline="central"
      fontSize={size}
      fontWeight={bold ? 600 : 400}
      fill={TONE[tone]}
      className={mono ? 'font-mono' : undefined}
    >
      {lines.map((text, i) => (
        <tspan key={i} x={x} y={y + i * size * 1.25}>
          {text}
        </tspan>
      ))}
    </text>
  );
}

/** A rounded box with centred text. The current step's boxes get a heavier accent outline. */
export function Box({
  x,
  y,
  w,
  h,
  lines,
  state = 'off',
  size = 10,
  dashed = false,
  bold = true,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  lines: readonly string[];
  state?: Emphasis;
  size?: number;
  dashed?: boolean;
  bold?: boolean;
}) {
  return (
    <Layer state={state}>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={6}
        fill="var(--bg)"
        stroke={line(state)}
        strokeWidth={state === 'on' ? 2.5 : 1}
        strokeDasharray={dashed ? '4 3' : undefined}
        className={EASE}
      />
      <Label x={x + w / 2} y={y + h / 2 - ((lines.length - 1) * size * 1.25) / 2} lines={lines} size={size} bold={bold} />
    </Layer>
  );
}

const HEAD = 6;

function arrowHead(tip: Point, from: Point): string {
  const angle = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
  const corner = (turn: number) =>
    `${(tip[0] - HEAD * Math.cos(angle + turn)).toFixed(1)},${(tip[1] - HEAD * Math.sin(angle + turn)).toFixed(1)}`;
  return `${tip[0]},${tip[1]} ${corner(0.45)} ${corner(-0.45)}`;
}

/** A straight arrow from one point to another, with a head at the end (and at the start when `both`). */
export function Arrow({
  from,
  to,
  state = 'off',
  dashed = false,
  both = false,
}: {
  from: Point;
  to: Point;
  state?: Emphasis;
  dashed?: boolean;
  both?: boolean;
}) {
  const colour = line(state);
  return (
    <Layer state={state}>
      <line
        x1={from[0]}
        y1={from[1]}
        x2={to[0]}
        y2={to[1]}
        stroke={colour}
        strokeWidth={state === 'on' ? 2 : 1.25}
        strokeDasharray={dashed ? '4 3' : undefined}
        className={EASE}
      />
      <polygon points={arrowHead(to, from)} fill={colour} stroke="none" />
      {both && <polygon points={arrowHead(from, to)} fill={colour} stroke="none" />}
    </Layer>
  );
}
