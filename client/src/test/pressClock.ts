import { setPressClock } from '../ui/pressGuard';

let now = 0;
let held = false;

/**
 * Puts the press guard on the clock of the tests. No test waits between a change on screen and its next
 * press, so unless a test holds the clock, every look at it finds that a second has gone by: a press
 * always lands after the settle window. Called before each test (see `setup.ts`).
 */
export function resetPressClock(): void {
  held = false;
  setPressClock(() => (held ? now : (now += 1000)));
}

/**
 * For a test about the settle window: from here on time stands still until the test moves it, so a press
 * is inside or outside the window exactly as the test says. Lasts until the end of the test.
 */
export function holdPressClock(): { advance(ms: number): void } {
  held = true;
  return {
    advance(ms) {
      now += ms;
    },
  };
}
