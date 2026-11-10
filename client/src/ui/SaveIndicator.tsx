import { useRef, useSyncExternalStore } from 'react';
import { saveQueue, type SaveQueue, type SaveState } from '../api/saveQueue';

const TEXT: Record<SaveState, string> = {
  idle: '',
  saving: 'Saving…',
  unsaved: 'Not saved yet. Retrying…',
  failed: "Couldn't save one of your answers.",
};
const SEVERAL_FAILED = "Couldn't save some of your answers.";

const TONE: Record<SaveState, string> = {
  idle: 'text-muted',
  saving: 'text-muted',
  unsaved: 'text-warn',
  failed: 'text-bad',
};

export function SaveIndicator({ queue = saveQueue }: { queue?: SaveQueue }) {
  const state = useSyncExternalStore(queue.subscribe, queue.state);
  // The count only changes while the queue is at work, so it is always current when `failed` is shown.
  const dropped = useSyncExternalStore(queue.subscribe, queue.dropped);
  const container = useRef<HTMLSpanElement>(null);

  function dismiss() {
    // The button is about to unmount; park focus on the indicator so it does not fall back to <body>
    // and the next Tab continues from here.
    container.current?.focus();
    queue.dismiss();
  }

  return (
    <span ref={container} tabIndex={-1} className="inline-flex items-center gap-2 text-sm">
      <span role="status" aria-live="polite" className={TONE[state]}>
        {state === 'failed' && dropped > 1 ? SEVERAL_FAILED : TEXT[state]}
      </span>
      {state === 'failed' && (
        <button
          type="button"
          onClick={dismiss}
          className="rounded-md border border-border px-2 py-0.5 hover:border-accent"
        >
          Dismiss
        </button>
      )}
    </span>
  );
}
