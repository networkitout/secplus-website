const DAY_MS = 86_400_000;

export function safeTimeZone(tz: string | null | undefined): string {
  if (!tz) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

export function localDate(at: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: safeTimeZone(tz),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
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
