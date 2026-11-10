import { afterEach, describe, expect, it } from 'vitest';
import { formatCalendarDate, formatDay, formatInstant } from './dates';

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

  it('a near date is named by its weekday, and is that day in any time zone of the device', () => {
    process.env.TZ = 'America/Los_Angeles';
    // The zone really is in force here: read as an instant, the date would land on the day before.
    expect(new Date('2026-11-01').getDate()).toBe(31);
    for (const zone of ['America/Los_Angeles', 'Pacific/Kiritimati', 'UTC']) {
      process.env.TZ = zone;
      expect(formatDay('2026-11-01', 'en-GB')).toBe('Sunday 1 November');
      expect(formatDay('2026-11-12', 'en-US')).toBe('Thursday, November 12');
    }
    // Without a locale it is the learner's own.
    expect(formatDay('2026-11-01')).toBe(
      new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(Date.UTC(2026, 10, 1)),
    );
  });

  it('text that is not a calendar date is shown as it is', () => {
    expect(formatCalendarDate('soon', 'en-GB')).toBe('soon');
    // Not as "Invalid Date".
    expect(formatDay('soon')).toBe('soon');
  });

  it('an instant is shown in the time zone given, and an unknown zone does not break the page', () => {
    expect(formatInstant('2026-11-08T23:30:00.000Z', 'America/New_York', { locale: 'en-GB' })).toBe('8 Nov 2026');
    expect(formatInstant('2026-11-08T12:00:00.000Z', 'Not/AZone', { locale: 'en-GB' })).toContain('2026');
    expect(formatInstant('not a date', 'UTC', { locale: 'en-GB' })).toBe('not a date');
  });

  it('a time of day names its time zone, so that it cannot be taken for the time on the device', () => {
    const at = '2026-11-08T23:30:00.000Z';
    expect(formatInstant(at, 'UTC', { locale: 'en-GB', time: true })).toBe('8 Nov 2026, 23:30 UTC');
    expect(formatInstant(at, 'Asia/Tokyo', { locale: 'en-GB', time: true })).toBe('9 Nov 2026, 08:30 GMT+9');
    expect(formatInstant(at, 'America/New_York', { locale: 'en-US', time: true })).toBe('Nov 8, 2026, 6:30 PM EST');
    // A date alone names none.
    expect(formatInstant(at, 'UTC', { locale: 'en-GB' })).toBe('8 Nov 2026');
    // An unknown zone falls back to the device's, and says which that is.
    process.env.TZ = 'Asia/Tokyo';
    expect(formatInstant(at, 'Not/AZone', { locale: 'en-GB', time: true })).toBe('9 Nov 2026, 08:30 GMT+9');
  });
});
