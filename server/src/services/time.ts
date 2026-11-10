const DAY_MS = 86_400_000;

/**
 * One date formatter per time zone: building one costs about as much as forty `format` calls. Keyed by the
 * lower-cased name, because `Intl` takes a zone name in any case; only zones `Intl` accepts are kept, and
 * that is a fixed list, so the cache cannot grow without bound.
 */
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(tz: string): Intl.DateTimeFormat | undefined {
  const key = tz.toLowerCase();
  let formatter = formatters.get(key);
  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    } catch {
      return undefined;
    }
    formatters.set(key, formatter);
  }
  return formatter;
}

export function safeTimeZone(tz: string | null | undefined): string {
  return tz && formatterFor(tz) ? tz : 'UTC';
}

export function localDate(at: Date, tz: string): string {
  return (formatterFor(tz) ?? formatterFor('UTC')!).format(at);
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function weekStartUtc(at: Date): Date {
  const midnight = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate());
  const sinceMonday = (at.getUTCDay() + 6) % 7;
  return new Date(midnight - sinceMonday * DAY_MS);
}

/** Consecutive active days ending today or yesterday. */
export function streak(activeDates: string[], today: string): number {
  const days = new Set(activeDates);
  let cursor = days.has(today) ? today : addDays(today, -1);
  let count = 0;
  while (days.has(cursor)) {
    count += 1;
    cursor = addDays(cursor, -1);
  }
  return count;
}
