import { useEffect, useId, useRef, type KeyboardEvent } from 'react';
import { Button } from '../../ui/Button';

/**
 * Asks before an exam is submitted. A modal dialog: focus starts on the safe choice, Tab stays inside,
 * Escape cancels, and focus goes back to where it was when the dialog closes.
 */
export function SubmitDialog({
  unanswered,
  flagged,
  onConfirm,
  onCancel,
}: {
  unanswered: number;
  flagged: number;
  onConfirm(): void;
  onCancel(): void;
}) {
  const titleId = useId();
  const bodyId = useId();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    box.current?.querySelector('button')?.focus();
    return () => opener?.focus();
  }, []);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onCancel();
      return;
    }
    if (e.key !== 'Tab') return;
    const buttons = [...(box.current?.querySelectorAll('button') ?? [])];
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (!first || !last) return;
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !box.current?.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !box.current?.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-bg/80 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        onKeyDown={onKeyDown}
        className="w-full max-w-md space-y-4 rounded-lg border border-border bg-surface p-5 shadow-xl"
      >
        <h2 id={titleId} className="text-lg font-semibold">
          Submit exam?
        </h2>
        <div id={bodyId} className="space-y-2">
          <p className="font-medium">{`${unanswered} unanswered, ${flagged} flagged.`}</p>
          <p className="text-sm text-muted">
            {unanswered > 0 ? 'Unanswered questions count as wrong. ' : ''}You can't change your answers after you submit.
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="secondary" onClick={onCancel}>
            Keep working
          </Button>
          <Button onClick={onConfirm}>Submit now</Button>
        </div>
      </div>
    </div>
  );
}
