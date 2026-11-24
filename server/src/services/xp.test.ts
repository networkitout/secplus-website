import { expect, test } from 'vitest';
import { BADGES, levelForXp, XP, xpForLevel } from './xp.js';

test('levels', () => {
  expect([0, 99, 100, 399, 400, 900].map(levelForXp)).toEqual([1, 1, 2, 2, 3, 4]);
  expect(xpForLevel(3)).toBe(400);
  expect(xpForLevel(1)).toBe(0);
});

test('XP values and badge ids', () => {
  expect(XP).toEqual({ lessonComplete: 50, firstCorrect: 10, repeatCorrect: 2, flashcardKnown: 2,
    objectiveQuizPass: 100, domainExamPass: 300, mockExamPass: 500, labPass: 75 });
  expect(BADGES.map((b) => b.id)).toEqual(['first-lesson', 'first-quiz-pass', 'domain-1-complete', 'streak-3',
    'streak-7', 'streak-30', 'hundred-correct', 'lab-rat', 'first-mock-pass']);
});
