import { useSyncExternalStore } from 'react';
import { saveQueue, type SaveQueue, type SaveState } from '../api/saveQueue';

const TEXT: Record<SaveState, string> = {
  idle: '',
  saving: 'Saving…',
  unsaved: 'Not saved yet. Retrying…',
  failed: "Couldn't save your last answer.",
};

const TONE: Record<SaveState, string> = {
  idle: 'text-muted',
  saving: 'text-muted',
  unsaved: 'text-warn',
  failed: 'text-bad',
};

export function SaveIndicator({ queue = saveQueue }: { queue?: SaveQueue }) {
  const state = useSyncExternalStore(queue.subscribe, queue.state);
  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <span role="status" aria-live="polite" className={TONE[state]}>
        {TEXT[state]}
      </span>
      {state === 'failed' && (
        <button
          type="button"
          onClick={() => queue.dismiss()}
          className="rounded-md border border-border px-2 py-0.5 hover:border-accent"
        >
          Dismiss
        </button>
      )}
    </span>
  );
}
