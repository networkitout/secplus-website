import { useLayoutEffect, useMemo, useRef } from 'react';

/**
 * How long presses are ignored after an action appeared. A double click or double tap, an impatient second
 * tap and a held Enter key all send a press when the button under them may already be another one ("Check"
 * has become "Next", "Show answer" has become "I knew it"); without the pause that press would act unseen.
 * A time window is used because it is the same for mouse, touch and keyboard: the click count of an event
 * is not (it is 1 for every tap in iOS Safari, 0 for the keyboard, and 1 again for a slow second press).
 */
export const SETTLE_MS = 500;

const monotonic = () => performance.now();
let now = monotonic;

/** Replaces the clock that the settle window is measured on (tests do); `null` puts the real one back. */
export function setPressClock(clock: (() => number) | null): void {
  now = clock ?? monotonic;
}

export interface PressGuard {
  /** False until the settle window after the last change is over: a press that arrives before that is ignored. */
  settled(): boolean;
  /** Starts the window now, for a change that is decided but not on screen yet. */
  restart(): void;
}

/**
 * For the part of a screen whose main action changes in place. `stage` says what that action is now (any
 * value that changes when the action does: "check" or "next", the number of the question). The window
 * starts when the part appears and again whenever `stage` changes. Every handler and keyboard shortcut of
 * that part asks `settled()` first and does nothing when it is false: nothing is sent, focus stays, and
 * the button is not disabled (a disabled button would drop keyboard focus).
 *
 * A request that is on its way is a separate matter: the screen's own guard still keeps a second one out.
 */
export function usePressGuard(stage: unknown = null): PressGuard {
  const since = useRef<number | null>(null);
  // A layout effect: the time is taken when the new action is in the page, before a press can reach it.
  useLayoutEffect(() => {
    since.current = now();
  }, [stage]);
  return useMemo(
    () => ({
      settled: () => since.current !== null && now() - since.current >= SETTLE_MS,
      restart: () => {
        since.current = now();
      },
    }),
    [],
  );
}
