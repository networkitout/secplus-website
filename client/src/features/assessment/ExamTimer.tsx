import { useEffect, useId, useRef, useState } from 'react';

const LOW_SECONDS = 5 * 60;
/** The warnings, nearest the end first. Each is announced once, when the time left is first seen at or below it. */
const MARKS = [
  { at: 60, onTime: '1 minute remaining', late: 'Less than 1 minute remaining' },
  { at: LOW_SECONDS, onTime: '5 minutes remaining', late: 'Less than 5 minutes remaining' },
];
/** A mark seen within this many seconds of being reached is announced as reached; later, as passed. */
const ON_TIME_SECONDS = 2;
/** How long an announcement stays in the live region: long enough to be read, not there to be read again. */
const ANNOUNCEMENT_MS = 5000;

const two = (n: number) => String(n).padStart(2, '0');

/**
 * Counts down to `deadlineAt` on the server's clock: `offsetMs` is how far that clock is ahead of this
 * device's. The time left is worked out from the clock on every tick, so a tab that was asleep shows the
 * right time when it wakes. Calls `onExpire` when no time is left (also when there was none to begin with).
 *
 * With `offsetMs` null the server's time is not known. The countdown then runs on the device clock and
 * says that it is approximate, and `onExpire` means only "the device clock has run out".
 */
export function ExamTimer({ deadlineAt, offsetMs, onExpire }: { deadlineAt: string; offsetMs: number | null; onExpire(): void }) {
  const deadline = Date.parse(deadlineAt);
  const offset = offsetMs ?? 0;
  const [seconds, setSeconds] = useState(() => secondsLeft(deadline, offset));
  const [announcement, setAnnouncement] = useState('');
  const labelId = useId();
  // Survives a change of offset, so that a mark is not announced a second time.
  const announced = useRef(new Set<number>());

  const latestOnExpire = useRef(onExpire);
  useEffect(() => {
    latestOnExpire.current = onExpire;
  }, [onExpire]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      const now = secondsLeft(deadline, offset);
      setSeconds(now);
      const mark = now > 0 ? MARKS.find((m) => now <= m.at) : undefined;
      if (mark && !announced.current.has(mark.at)) {
        // A slow tick, or a page opened late, can find the mark already passed: say what is true.
        setAnnouncement(now > mark.at - ON_TIME_SECONDS ? mark.onTime : mark.late);
        for (const m of MARKS) if (m.at >= mark.at) announced.current.add(m.at);
      }
      if (now === 0) {
        latestOnExpire.current();
        return;
      }
      // Wake at the next whole second of time left, so the display never skips or lags.
      const ms = deadline - (Date.now() + offset);
      timer = setTimeout(tick, ms % 1000 || 1000);
    };
    tick();
    return () => clearTimeout(timer);
  }, [deadline, offset]);

  useEffect(() => {
    if (!announcement) return;
    const timer = setTimeout(() => setAnnouncement(''), ANNOUNCEMENT_MS);
    return () => clearTimeout(timer);
  }, [announcement]);

  const low = seconds <= LOW_SECONDS;
  const approximate = offsetMs === null;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span id={labelId} className="text-sm text-muted">
        Time left
      </span>
      {/* role="timer" is not announced as it changes; the two warnings go through the polite region below. */}
      <span role="timer" aria-labelledby={labelId} className={`font-mono text-lg tabular-nums ${low ? 'text-warn' : ''}`}>
        {`${two(Math.floor(seconds / 60))}:${two(seconds % 60)}`}
      </span>
      {approximate && <span className="text-sm text-muted">approximate</span>}
      {low && (
        <span className="inline-flex items-center gap-1 text-sm font-semibold text-warn">
          <span aria-hidden="true">⚠</span>
          <span>{seconds > 0 ? 'Low time' : approximate ? 'Checking the time…' : 'Time is up'}</span>
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
