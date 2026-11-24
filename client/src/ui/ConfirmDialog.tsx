import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Button } from './Button';
import { usePressGuard } from './pressGuard';

/** What Tab stops at: the body may hold links and fields besides the dialog's own two buttons. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Asks before something that cannot be taken back. A modal dialog: focus starts on the choice that changes
 * nothing, Tab stays inside, Escape cancels, and focus goes back to where it was when the dialog closes.
 * Render it only while it is open.
 *
 * It opens over the button that was pressed. A press that arrives straight after it opened (the second half
 * of a double click or double tap, a held Enter) is ignored: it neither confirms nor cancels. Escape is a
 * key of its own and works at once.
 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  cancelLabel = 'Cancel',
  busy = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  /** The body: what will happen. It is the dialog's description. */
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** The confirmed action is under way: the confirm button says so and further presses do nothing. */
  busy?: boolean;
  onConfirm(): void;
  onCancel(): void;
}) {
  const titleId = useId();
  const bodyId = useId();
  const box = useRef<HTMLDivElement>(null);
  const guard = usePressGuard();

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    box.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    return () => opener?.focus();
  }, []);

  // The keys are heard on the document, not on the dialog: after a click on its text, or on nothing at
  // all, focus is on no control of the dialog, and Escape and Tab must still work.
  const latestOnCancel = useRef(onCancel);
  useEffect(() => {
    latestOnCancel.current = onCancel;
  }, [onCancel]);
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        latestOnCancel.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const controls = [...(box.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      const onControl = controls.some((control) => control === active);
      if (e.shiftKey && (active === first || !onControl)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !onControl)) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-bg/80 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && guard.settled()) onCancel();
      }}
    >
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
        className="w-full max-w-md space-y-4 rounded-lg border border-border bg-surface p-5 shadow-xl"
      >
        <h2 id={titleId} className="text-lg font-semibold">
          {title}
        </h2>
        <div id={bodyId} className="space-y-2">
          {children}
        </div>
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="secondary" data-autofocus onClick={() => guard.settled() && onCancel()}>
            {cancelLabel}
          </Button>
          <Button aria-busy={busy} onClick={() => !busy && guard.settled() && onConfirm()}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
