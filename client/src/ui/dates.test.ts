import { afterEach, describe, expect, it } from 'vitest';
import { formatCalendarDate, formatInstant } from './dates';

describe('dates', () => {
  const tz = process.env.TZ;
  afterEach(() => {
    if (tz === undefined) delete process.env.TZ;
    else process.env.TZ = tz;
  });

  it('a calendar date is that day in any time zone of the device', () => {
    for (const zone of ['Pacific/Honolulu', 'UTC', 'Pacific/Kiritimati']) {
      process.env.TZ = zone;
      expect(formatCalendarDate('2026-11-01', 'en-GB')).toBe('1 November 2026');
      expect(formatCalendarDate('2026-03-31', 'en-GB')).toBe('31 March 2026');
    }
  });

  it('text that is not a calendar date is shown as it is', () => {
    expect(formatCalendarDate('soon', 'en-GB')).toBe('soon');
  });

  it('an instant is shown in the time zone given, and an unknown zone does not break the page', () => {
    expect(formatInstant('2026-11-08T23:30:00.000Z', 'America/New_York', { locale: 'en-GB' })).toBe('8 Nov 2026');
    expect(formatInstant('2026-11-08T23:30:00.000Z', 'Asia/Tokyo', { locale: 'en-GB', time: true })).toBe('9 Nov 2026, 08:30');
    expect(formatInstant('2026-11-08T12:00:00.000Z', 'Not/AZone', { locale: 'en-GB' })).toContain('2026');
    expect(formatInstant('not a date', 'UTC', { locale: 'en-GB' })).toBe('not a date');
  });
});
