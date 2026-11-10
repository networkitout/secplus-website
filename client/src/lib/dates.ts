/**
 * The day of a calendar date from the server (`YYYY-MM-DD`, already in the learner's time zone), as the
 * start of that day in UTC; null for anything else. Formatted in UTC it is that day itself: parsed as an
 * instant in the device's zone it would show the day before in time zones behind UTC.
 */
function calendarDay(date: string): number | null {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return parts ? Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])) : null;
}

function formatCalendar(date: string, format: Intl.DateTimeFormatOptions, locale?: string): string {
  const day = calendarDay(date);
  return day === null ? date : new Intl.DateTimeFormat(locale, { ...format, timeZone: 'UTC' }).format(day);
}

/** A calendar date from the server in words, with its year: "November 20, 2026". */
export function formatCalendarDate(date: string, locale?: string): string {
  return formatCalendar(date, { dateStyle: 'long' }, locale);
}

/** A calendar date from the server that is near, by its weekday and without the year: "Thursday, November 12". */
export function formatDay(date: string, locale?: string): string {
  return formatCalendar(date, { weekday: 'long', day: 'numeric', month: 'long' }, locale);
}

/** A date with its time of day. The zone is named: the time may be in another zone than the device's clock. */
const DATE_TIME: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
};

/**
 * An ISO timestamp from the server as a date in the given time zone: the learner's own, so that the day
 * agrees with the days the server counts. With `time` the time of day follows, with the short name of its
 * zone ("Nov 8, 2026, 6:30 PM EST").
 */
export function formatInstant(iso: string, timeZone: string, { time = false, locale }: { time?: boolean; locale?: string } = {}): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  const style: Intl.DateTimeFormatOptions = time ? DATE_TIME : { dateStyle: 'medium' };
  try {
    return new Intl.DateTimeFormat(locale, { ...style, timeZone }).format(at);
  } catch {
    // A time zone that this browser does not know: the device's own is better than no date.
    return new Intl.DateTimeFormat(locale, style).format(at);
  }
}
