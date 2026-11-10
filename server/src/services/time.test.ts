import { expect, test } from 'vitest';
import { addDays, localDate, safeTimeZone, streak, weekStartUtc } from './time.js';

test('safeTimeZone', () => {
  expect(safeTimeZone('America/Chicago')).toBe('America/Chicago');
  for (const bad of ['Mars/Olympus', '', null, undefined, '<script>']) expect(safeTimeZone(bad as any)).toBe('UTC');
});

test('localDate uses the learner calendar day', () => {
  const at = new Date('2026-11-11T03:30:00Z');
  expect(localDate(at, 'America/Chicago')).toBe('2026-11-10');
  expect(localDate(at, 'UTC')).toBe('2026-11-11');
});

test('localDate either side of the Chicago DST change', () => {
  expect(localDate(new Date('2026-11-01T05:30:00Z'), 'America/Chicago')).toBe('2026-11-01');
  expect(localDate(new Date('2026-11-01T04:30:00Z'), 'America/Chicago')).toBe('2026-10-31');
});

test('addDays across a DST change and month end', () => {
  expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
  expect(addDays('2026-03-07', 2)).toBe('2026-03-09');
});

test('weekStartUtc', () => {
  expect(weekStartUtc(new Date('2026-11-11T12:00:00Z')).toISOString()).toBe('2026-11-09T00:00:00.000Z');
  expect(weekStartUtc(new Date('2026-11-09T00:00:00Z')).toISOString()).toBe('2026-11-09T00:00:00.000Z');
  expect(weekStartUtc(new Date('2026-11-15T23:59:59Z')).toISOString()).toBe('2026-11-09T00:00:00.000Z');
});

test('streak', () => {
  expect(streak([], '2026-11-10')).toBe(0);
  expect(streak(['2026-11-10'], '2026-11-10')).toBe(1);
  expect(streak(['2026-11-08', '2026-11-09'], '2026-11-10')).toBe(2);
  expect(streak(['2026-11-07', '2026-11-08'], '2026-11-10')).toBe(0);
  expect(streak(['2026-11-10', '2026-11-10', '2026-11-09', '2026-11-07'], '2026-11-10')).toBe(2);
  expect(streak(['2026-10-31', '2026-11-01', '2026-11-02'], '2026-11-02')).toBe(3);
});
