import { expect, test, vi } from 'vitest';
import { addDays, isTimeZoneName, localDate, safeTimeZone, streak, weekStartUtc } from './time.js';

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

test('localDate builds one formatter per time zone, however often and in whatever case the zone is named', () => {
  const built = vi.spyOn(Intl, 'DateTimeFormat');
  try {
    const at = new Date('2026-11-11T03:30:00Z');
    for (let i = 0; i < 100; i++) expect(localDate(new Date(at.getTime() + i * 3_600_000), 'Asia/Kolkata')).toMatch(/^2026-11-1[1-5]$/);
    expect(built).toHaveBeenCalledTimes(1);
    // Intl takes zone names in any case; the variants share the one formatter, so the cache holds at most one per zone.
    expect(localDate(at, 'ASIA/KOLKATA')).toBe('2026-11-11');
    expect(localDate(at, 'asia/kolkata')).toBe('2026-11-11');
    expect(safeTimeZone('Asia/Kolkata')).toBe('Asia/Kolkata');
    expect(built).toHaveBeenCalledTimes(1);
  } finally {
    built.mockRestore();
  }
});

test('an unknown zone is never cached and dates fall back to UTC', () => {
  const at = new Date('2026-11-11T03:30:00Z');
  expect(localDate(at, 'Mars/Olympus')).toBe('2026-11-11');
  expect(localDate(at, 'Mars/Olympus')).toBe(localDate(at, 'UTC'));
  expect(safeTimeZone('Mars/Olympus')).toBe('UTC');
});

test('isTimeZoneName accepts the zone names Intl knows and nothing else; UTC offsets are not names', () => {
  for (const ok of ['UTC', 'America/Chicago', 'Europe/Paris', 'Asia/Kolkata', 'Etc/GMT+5', 'america/chicago']) {
    expect(isTimeZoneName(ok), ok).toBe(true);
  }
  for (const bad of ['+05:00', '-08:00', '+0530', '-03', 'Mars/Olympus', '', ' UTC', '<script>', null, undefined, 5, {}]) {
    expect(isTimeZoneName(bad), String(bad)).toBe(false);
  }
});

test('a UTC offset is not a stored zone: safeTimeZone gives UTC and localDate uses UTC', () => {
  expect(safeTimeZone('+05:00')).toBe('UTC');
  expect(safeTimeZone('-08:00')).toBe('UTC');
  expect(localDate(new Date('2026-11-10T23:30:00Z'), '+05:00')).toBe('2026-11-10');
});
