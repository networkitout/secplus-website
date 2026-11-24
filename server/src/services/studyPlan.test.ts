import { expect, test } from 'vitest';
import { studyPlan } from './studyPlan.js';

test('studyPlan', () => {
  expect(studyPlan({ today: '2026-11-10', examDate: null, objectivesRemaining: 5, reviewsDue: 0 })).toBeNull();
  expect(studyPlan({ today: '2026-11-10', examDate: '2026-11-20', objectivesRemaining: 25, reviewsDue: 4 })).toMatchObject({
    daysLeft: 10,
    objectivesPerDay: 3,
  });
  expect(studyPlan({ today: '2026-11-10', examDate: '2026-11-10', objectivesRemaining: 2, reviewsDue: 0 })).toMatchObject({
    daysLeft: 0,
    objectivesPerDay: 2,
  });
  expect(studyPlan({ today: '2026-11-10', examDate: '2026-11-01', objectivesRemaining: 2, reviewsDue: 0 })!.daysLeft).toBe(-9);
});

test('studyPlan message', () => {
  const m = (examDate: string, objectivesRemaining: number, reviewsDue: number) =>
    studyPlan({ today: '2026-11-10', examDate, objectivesRemaining, reviewsDue })!.message;
  expect(m('2026-11-20', 25, 4)).toBe('10 days to your exam: pass 3 objective quizzes a day and clear 4 reviews today.');
  expect(m('2026-11-11', 1, 0)).toBe('1 day to your exam: pass 1 objective quiz a day.');
  expect(m('2026-11-10', 0, 0)).toBe('Your exam is today. Every objective quiz is passed.');
  expect(m('2026-11-01', 2, 0)).toBe('Your exam date has passed. Update it in settings.');
});
