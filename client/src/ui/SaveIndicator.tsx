import { useSyncExternalStore } from 'react';
import { saveQueue, type SaveQueue } from '../api/saveQueue';

const TEXT = { idle: '', saving: 'Saving…', unsaved: 'Unsaved changes. Retrying…' } as const;

export function SaveIndicator({ queue = saveQueue }: { queue?: SaveQueue }) {
  const state = useSyncExternalStore(queue.subscribe, queue.state);
  return (
    <span role="status" aria-live="polite" className={`text-sm ${state === 'unsaved' ? 'text-warn' : 'text-muted'}`}>
      {TEXT[state]}
    </span>
  );
}
