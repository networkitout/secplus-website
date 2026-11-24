import { expect, test } from 'vitest';
import type { Item, Question } from '../../../shared/types.js';
import { AnswerShapeError, answerSchema, feedbackFor, grade, toPublicQuestion } from './scoring.js';

const it = (ids: string[]): Item[] => ids.map((id) => ({ id, text: `Text ${id}` }));
const base = { objective: '1.1', difficulty: 1 as const, prompt: 'P', explanation: 'E' };

const single: Question = {
  ...base, id: 'q-1.1-001', type: 'single', options: it(['a', 'b', 'c', 'd']), correct: 'b',
  why: { a: 'no a', b: 'yes b', c: 'no c', d: 'no d' },
};
const multi: Question = {
  ...base, id: 'q-1.1-002', type: 'multi', options: it(['a', 'b', 'c', 'd', 'e']), correct: ['a', 'c'],
  why: { a: 'wa', b: 'wb', c: 'wc', d: 'wd', e: 'we' },
};
const order: Question = {
  ...base, id: 'q-1.1-003', type: 'order', items: it(['1', '2', '3', '4']), correct: ['1', '2', '3', '4'],
};
const match: Question = {
  ...base, id: 'q-1.1-004', type: 'match', left: it(['l1', 'l2', 'l3']), right: it(['r1', 'r2', 'r3']),
  correct: { l1: 'r1', l2: 'r2', l3: 'r3' },
};
const cat: Question = {
  ...base, id: 'q-1.1-005', type: 'categorize', items: it(['i1', 'i2', 'i3', 'i4']), buckets: it(['b1', 'b2']),
  correct: { i1: 'b1', i2: 'b2', i3: 'b1', i4: 'b2' },
};

test('single', () => {
  expect(grade(single, { type: 'single', choice: 'b' })).toEqual({ correct: true, fraction: 1 });
  expect(grade(single, { type: 'single', choice: 'a' })).toEqual({ correct: false, fraction: 0 });
});
test('multi: order-insensitive, partial fraction, wrong picks subtract', () => {
  expect(grade(multi, { type: 'multi', choices: ['c', 'a'] }).correct).toBe(true);
  expect(grade(multi, { type: 'multi', choices: ['a'] })).toEqual({ correct: false, fraction: 0.5 });
  expect(grade(multi, { type: 'multi', choices: ['a', 'b'] })).toEqual({ correct: false, fraction: 0 });
});
test('order', () => {
  expect(grade(order, { type: 'order', order: ['1', '2', '3', '4'] }).correct).toBe(true);
  expect(grade(order, { type: 'order', order: ['2', '1', '3', '4'] })).toEqual({ correct: false, fraction: 0.5 });
});
test('match and categorize give share placed correctly', () => {
  expect(grade(match, { type: 'match', pairs: { l1: 'r1', l2: 'r3', l3: 'r2' } }).fraction).toBeCloseTo(1 / 3);
  expect(grade(cat, { type: 'categorize', placements: (cat as any).correct }).correct).toBe(true);
});
test('omitted match and categorize entries score as wrong, not as errors', () => {
  expect(grade(match, { type: 'match', pairs: { l1: 'r1' } })).toEqual({ correct: false, fraction: 1 / 3 });
  expect(grade(cat, { type: 'categorize', placements: { i1: 'b1' } })).toEqual({ correct: false, fraction: 0.25 });
});
test.each([
  ['type mismatch', single, { type: 'multi', choices: ['a'] }],
  ['unknown option id', single, { type: 'single', choice: 'zzz' }],
  ['order missing an item', order, { type: 'order', order: ['1', '2'] }],
  ['order with a duplicate', order, { type: 'order', order: ['1', '1', '3', '4'] }],
  ['multi with a duplicate', multi, { type: 'multi', choices: ['a', 'a'] }],
  ['multi with unknown id', multi, { type: 'multi', choices: ['a', 'zzz'] }],
  ['match with unknown left', match, { type: 'match', pairs: { zzz: 'r1' } }],
  ['match with unknown right', match, { type: 'match', pairs: { l1: 'zzz' } }],
  ['categorize with unknown item', cat, { type: 'categorize', placements: { zzz: 'b1' } }],
  ['categorize with unknown bucket', cat, { type: 'categorize', placements: { i1: 'zzz' } }],
])('rejects %s', (_n, q, a) => expect(() => grade(q as any, a as any)).toThrow(AnswerShapeError));
test('toPublicQuestion strips answers and is deterministic', () => {
  for (const q of [single, multi, order, match, cat]) {
    const p = toPublicQuestion(q, 'seed') as any;
    expect(p.correct).toBeUndefined(); expect(p.explanation).toBeUndefined(); expect(p.why).toBeUndefined();
    expect(toPublicQuestion(q, 'seed')).toEqual(p);
  }
});
test('toPublicQuestion keeps the same items, just shuffled', () => {
  const p = toPublicQuestion(multi, 'seed') as any;
  expect(p.options.map((i: Item) => i.id).sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
});
test('order items are not served in the correct order', () => {
  const p = toPublicQuestion(order, 'any-seed') as any;
  expect(p.items.map((i: Item) => i.id)).not.toEqual((order as any).correct);
  for (let n = 0; n < 50; n++) {
    const q = toPublicQuestion(order, `s${n}`) as any;
    expect(q.items.map((i: Item) => i.id)).not.toEqual((order as any).correct);
  }
});
test('feedbackFor includes correct answer, explanation and why', () =>
  expect(feedbackFor(single, { type: 'single', choice: 'a' })).toEqual({
    correct: false, fraction: 0, correctAnswer: { type: 'single', choice: 'b' },
    explanation: single.explanation, why: (single as any).why }));
test('feedbackFor covers order, match and categorize', () => {
  expect(feedbackFor(order, { type: 'order', order: ['1', '2', '3', '4'] })).toMatchObject({
    correct: true, correctAnswer: { type: 'order', order: ['1', '2', '3', '4'] } });
  expect(feedbackFor(match, { type: 'match', pairs: {} }).correctAnswer).toEqual({ type: 'match', pairs: (match as any).correct });
  expect(feedbackFor(cat, { type: 'categorize', placements: {} }).why).toBeUndefined();
});
test('answerSchema accepts valid answers and rejects bad ones', () => {
  expect(answerSchema.safeParse({ type: 'single', choice: 'a' }).success).toBe(true);
  expect(answerSchema.safeParse({ type: 'order', order: ['1'] }).success).toBe(true);
  expect(answerSchema.safeParse({ type: 'single', choices: ['a'] }).success).toBe(false);
  expect(answerSchema.safeParse({ type: 'nope' }).success).toBe(false);
});
