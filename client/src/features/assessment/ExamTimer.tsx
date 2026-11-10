import { useEffect, useId, useRef, useState } from 'react';

const LOW_SECONDS = 5 * 60;
const LAST_MINUTE_SECONDS = 60;

const two = (n: number) => String(n).padStart(2, '0');

/**
 * Counts down to `deadlineAt` on the server's clock: `offsetMs` is how far that clock is ahead of this
 * device's. The time left is worked out from the clock on every tick, so a tab that was asleep shows the
 * right time when it wakes. Calls `onExpire` when no time is left (also when there was none to begin with).
 */
export function ExamTimer({ deadlineAt, offsetMs, onExpire }: { deadlineAt: string; offsetMs: number; onExpire(): void }) {
  const deadline = Date.parse(deadlineAt);
  const [seconds, setSeconds] = useState(() => secondsLeft(deadline, offsetMs));
  const [announcement, setAnnouncement] = useState('');
  const labelId = useId();

  const latestOnExpire = useRef(onExpire);
  useEffect(() => {
    latestOnExpire.current = onExpire;
  }, [onExpire]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    // A warning is announced when its mark is crossed while the exam is open, not for a mark already passed.
    let previous = secondsLeft(deadline, offsetMs);
    const tick = () => {
      const now = secondsLeft(deadline, offsetMs);
      setSeconds(now);
      if (previous > LOW_SECONDS && now <= LOW_SECONDS && now > LAST_MINUTE_SECONDS) setAnnouncement('5 minutes remaining');
      if (previous > LAST_MINUTE_SECONDS && now <= LAST_MINUTE_SECONDS && now > 0) setAnnouncement('1 minute remaining');
      previous = now;
      if (now === 0) {
        latestOnExpire.current();
        return;
      }
      // Wake at the next whole second of time left, so the display never skips or lags.
      const ms = deadline - (Date.now() + offsetMs);
      timer = setTimeout(tick, ms % 1000 || 1000);
    };
    tick();
    return () => clearTimeout(timer);
  }, [deadline, offsetMs]);

  const low = seconds <= LOW_SECONDS;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span id={labelId} className="text-sm text-muted">
        Time left
      </span>
      {/* role="timer" is not announced as it changes; the two warnings go through the polite region below. */}
      <span role="timer" aria-labelledby={labelId} className={`font-mono text-lg tabular-nums ${low ? 'text-warn' : ''}`}>
        {`${two(Math.floor(seconds / 60))}:${two(seconds % 60)}`}
      </span>
      {low && (
        <span className="inline-flex items-center gap-1 text-sm font-semibold text-warn">
          <span aria-hidden="true">⚠</span>
          <span>{seconds === 0 ? 'Time is up' : 'Low time'}</span>
        </span>
      )}
      <span role="status" aria-label="Time alerts" className="sr-only">
        {announcement}
      </span>
    </div>
  );
}

function secondsLeft(deadline: number, offsetMs: number): number {
  return Math.max(0, Math.ceil((deadline - (Date.now() + offsetMs)) / 1000));
}
