/**
 * A calendar date from the server (`YYYY-MM-DD`, already in the learner's time zone) in the learner's
 * locale. It is read as that day itself: parsing it as an instant would show the day before in time zones
 * behind UTC.
 */
export function formatDay(date: string): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!parts) return date;
  const day = Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
  return new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(day);
}
