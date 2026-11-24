import { expect, test } from 'vitest';
import { dueOn, INTERVALS, nextBox } from './leitner.js';

test('intervals', () => expect(INTERVALS).toEqual([1, 2, 4, 8, 16]));

test('nextBox', () => {
  expect([1, 2, 3, 4, 5].map((b) => nextBox(b, true))).toEqual([2, 3, 4, 5, 5]);
  expect([1, 3, 5].map((b) => nextBox(b, false))).toEqual([1, 1, 1]);
});

test('dueOn', () =>
  expect([1, 2, 3, 4, 5].map((b) => dueOn(b, '2026-11-10'))).toEqual([
    '2026-11-11',
    '2026-11-12',
    '2026-11-14',
    '2026-11-18',
    '2026-11-26',
  ]));
