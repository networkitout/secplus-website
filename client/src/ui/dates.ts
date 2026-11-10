/**
 * A calendar date from the server (`YYYY-MM-DD`, already in the learner's time zone) in words. It is read as
 * that day itself: parsed as an instant it would show the day before in time zones behind UTC.
 */
export function formatCalendarDate(date: string, locale?: string): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!parts) return date;
  const day = Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
  return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(day);
}

/**
 * An ISO timestamp from the server as a date (with `time`, also the time of day) in the given time zone:
 * the learner's own, so that the day agrees with the days the server counts.
 */
export function formatInstant(iso: string, timeZone: string, { time = false, locale }: { time?: boolean; locale?: string } = {}): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  const style: Intl.DateTimeFormatOptions = time ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' };
  try {
    return new Intl.DateTimeFormat(locale, { ...style, timeZone }).format(at);
  } catch {
    // A time zone that this browser does not know: the device's own is better than no date.
    return new Intl.DateTimeFormat(locale, style).format(at);
  }
}
