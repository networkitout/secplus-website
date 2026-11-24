import { expect, test } from 'vitest';
import { domainMastery, objectiveMastery, readiness } from './mastery.js';

test('objectiveMastery', () => {
  expect(objectiveMastery(['a', 'b', 'c', 'd'], new Map([['a', true], ['b', false], ['c', true]]))).toBe(50);
  expect(objectiveMastery([], new Map())).toBe(0);
  expect(objectiveMastery(['a'], new Map([['a', true], ['gone', true]]))).toBe(100); // attempts on removed questions ignored
});

test('domainMastery weights by question count', () => {
  expect(domainMastery([{ mastery: 100, questionCount: 30 }, { mastery: 0, questionCount: 10 }])).toBe(75);
  expect(domainMastery([])).toBe(0);
  expect(domainMastery([{ mastery: 90, questionCount: 0 }])).toBe(0);
});

const all = { 1: 85, 2: 90, 3: 80, 4: 82, 5: 95 };

test('readiness', () => {
  expect(readiness({ domainMastery: all, lastMockScores: [820, 790, 800], allDomainsPublished: true })).toEqual({ ready: true, missing: [] });
  expect(readiness({ domainMastery: all, lastMockScores: [820, 790, 780], allDomainsPublished: true }).ready).toBe(false);
  expect(readiness({ domainMastery: { ...all, 2: 64 }, lastMockScores: [900, 900, 900], allDomainsPublished: true }).missing).toEqual([
    'Domain 2 mastery is 64%; aim for 80%',
  ]);
  expect(readiness({ domainMastery: all, lastMockScores: [900], allDomainsPublished: true }).missing).toEqual(['Take 2 more mock exams']);
  expect(readiness({ domainMastery: all, lastMockScores: [900, 900, 900], allDomainsPublished: false }).ready).toBe(false);
});

test('readiness missing sentences are ordered and worded exactly', () => {
  expect(readiness({ domainMastery: all, lastMockScores: [], allDomainsPublished: true }).missing).toEqual(['Take 3 more mock exams']);
  expect(readiness({ domainMastery: all, lastMockScores: [900, 900], allDomainsPublished: true }).missing).toEqual(['Take 1 more mock exam']);
  expect(readiness({ domainMastery: all, lastMockScores: [700, 750, 780], allDomainsPublished: true }).missing).toEqual([
    'Average of last three mock exams is 743; aim for 800',
  ]);
  expect(
    readiness({ domainMastery: { 1: 0, 2: 64.4, 3: 80, 4: 10, 5: 79 }, lastMockScores: [700, 700, 700], allDomainsPublished: false }).missing,
  ).toEqual([
    'Content for all five domains is not available yet',
    'Average of last three mock exams is 700; aim for 800',
    'Domain 1 mastery is 0%; aim for 80%',
    'Domain 2 mastery is 64%; aim for 80%',
    'Domain 4 mastery is 10%; aim for 80%',
    'Domain 5 mastery is 79%; aim for 80%',
  ]);
});
