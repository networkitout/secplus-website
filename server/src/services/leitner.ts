import { addDays } from './time.js';

/** Days until the next review, by Leitner box 1-5. */
export const INTERVALS = [1, 2, 4, 8, 16];

const MAX_BOX = INTERVALS.length;

export function nextBox(box: number, correct: boolean): number {
  return correct ? Math.min(box + 1, MAX_BOX) : 1;
}

export function dueOn(box: number, today: string): string {
  const b = Math.min(Math.max(Math.trunc(box), 1), MAX_BOX);
  return addDays(today, INTERVALS[b - 1]!);
}
