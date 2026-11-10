import { useId, useState, type ReactNode } from 'react';
import { Button } from '../../ui/Button';

export type DiagramStep = { title: string; description: string };

/**
 * A drawing that is explained one step at a time. `render` returns the SVG for a step; the step's title
 * names the drawing and its description is announced when the step changes.
 */
export function StepDiagram({
  title,
  steps,
  render,
}: {
  title: string;
  steps: DiagramStep[];
  render(stepIndex: number): ReactNode;
}) {
  const [index, setIndex] = useState(0);
  const titleId = useId();
  const last = steps.length - 1;
  const step = steps[index]!;

  // Back and Next stay focusable at the ends (`aria-disabled`, not `disabled`), so a keyboard user who
  // reaches the last step is not dropped out of the controls.
  const control = (label: string, target: number, variant: 'primary' | 'secondary') => {
    const unavailable = target < 0 || target > last;
    return (
      <Button
        variant={variant}
        aria-disabled={unavailable || undefined}
        className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
        onClick={() => !unavailable && setIndex(target)}
      >
        {label}
      </Button>
    );
  };

  return (
    <div role="group" aria-labelledby={titleId} className="my-6 rounded-lg border border-border bg-surface">
      <p id={titleId} className="border-b border-border px-4 py-3 font-semibold">
        {title}
      </p>
      <div role="img" aria-label={step.title} className="mx-auto w-full max-w-[30rem]">
        {render(index)}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
        {control('Back', index - 1, 'secondary')}
        {control('Next', index + 1, 'primary')}
        <Button variant="secondary" onClick={() => setIndex(0)}>
          Replay
        </Button>
        <p className="ml-auto font-mono text-sm text-muted">{`Step ${index + 1} of ${steps.length}`}</p>
      </div>
      <div aria-live="polite" className="space-y-1 px-4 pb-4">
        <p className="font-semibold">{step.title}</p>
        <p className="text-sm leading-relaxed">{step.description}</p>
      </div>
    </div>
  );
}
