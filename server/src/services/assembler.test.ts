import { expect, test } from 'vitest';
import type { Question } from '../../../shared/types.js';
import type { Content } from '../content/loader.js';
import { fixtureContent } from '../test/helpers.js';
import { pickMock, pickQuiz, scaledScore, seededRng } from './assembler.js';

const q = (id: string, objective: string, type: Question['type'] = 'single'): Question =>
  ({ id, objective, type, difficulty: 1, prompt: 'p', explanation: 'e' }) as unknown as Question;

test('pickQuiz prefers unseen then oldest-seen, no duplicates', () => {
  const pool = Array.from({ length: 12 }, (_, i) => q(`q${i}`, '1.1'));
  // q0..q4 seen; q0 oldest ... q4 newest
  const seen = new Map(pool.slice(0, 5).map((p, i) => [p.id, 1000 + i * 10]));
  const picked = pickQuiz(pool, seen, 10, seededRng('a'));
  expect(picked).toHaveLength(10);
  expect(new Set(picked).size).toBe(10);
  for (const p of pool.slice(5)) expect(picked).toContain(p.id);
  for (const id of ['q0', 'q1', 'q2']) expect(picked).toContain(id);
  expect(picked).not.toContain('q3');
  expect(picked).not.toContain('q4');
});

test('pickQuiz returns the whole pool when n exceeds it', () => {
  const pool = Array.from({ length: 4 }, (_, i) => q(`q${i}`, '1.1'));
  expect([...pickQuiz(pool, new Map(), 10, seededRng('b'))].sort()).toEqual(['q0', 'q1', 'q2', 'q3']);
});

test('pickMock on fixture content', () => {
  const content = fixtureContent();
  const m = pickMock(content, new Map(), seededRng('x'));
  expect(m.questionIds).toHaveLength(4);
  expect(new Set(m.questionIds).size).toBe(4);
  expect(m.minutes).toBe(4);
  expect(m.partial).toBe(true);
  const types = m.questionIds.map((id) => content.questions.get(id)!.type);
  const firstNonPbq = types.findIndex((t) => t === 'single' || t === 'multi');
  expect(types.slice(firstNonPbq).every((t) => t === 'single' || t === 'multi')).toBe(true);
  expect(firstNonPbq).toBeLessThanOrEqual(3);
});

test('pickMock with a full synthetic manifest returns 90 questions split 11/20/16/25/18, 90 minutes, partial false', () => {
  const counts = [11, 20, 16, 25, 18];
  const questions = new Map<string, Question>();
  const byObjective = new Map<string, Question[]>();
  const domains = counts.map((mockCount, d) => {
    const objectives = [1, 2, 3].map((o) => ({ id: `${d + 1}.${o}`, title: 't', published: true, minQuestions: 3 }));
    for (const o of objectives) {
      const list = Array.from({ length: 20 }, (_, i) =>
        q(`q-${o.id}-${i}`, o.id, (['single', 'order', 'match', 'categorize', 'multi'] as const)[i % 5]),
      );
      byObjective.set(o.id, list);
      for (const x of list) questions.set(x.id, x);
    }
    return { id: d + 1, title: 'd', weight: 20, mockCount, objectives };
  });
  const content = { manifest: { exam: 'SY0-701', domains }, questionsFor: (o: string) => byObjective.get(o) ?? [] } as unknown as Content;
  const m = pickMock(content, new Map(), seededRng('full'));
  expect(m.questionIds).toHaveLength(90);
  expect(new Set(m.questionIds).size).toBe(90);
  expect(m.minutes).toBe(90);
  expect(m.partial).toBe(false);
  const perDomain = [0, 0, 0, 0, 0];
  for (const id of m.questionIds) perDomain[Number(questions.get(id)!.objective.split('.')[0]) - 1]!++;
  expect(perDomain).toEqual(counts);
  // 11 over 3 objectives is spread 4/4/3
  const inDomain1 = m.questionIds.filter((id) => id.startsWith('q-1.'));
  const perObjective = [1, 2, 3].map((o) => inDomain1.filter((id) => id.startsWith(`q-1.${o}-`)).length).sort();
  expect(perObjective).toEqual([3, 4, 4]);
  const types = m.questionIds.map((id) => questions.get(id)!.type);
  expect(types.slice(0, 3).every((t) => t === 'order' || t === 'match' || t === 'categorize')).toBe(true);
});

test('scaledScore', () => expect([0, 0.8125, 1, 0.5].map(scaledScore)).toEqual([100, 750, 900, 500]));
