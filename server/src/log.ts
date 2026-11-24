/** An error in one line: its code, when it has one, and its message. Safe to print for a database error. */
export function errorLine(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const code = (err as { code?: unknown }).code;
  return `${typeof code === 'string' ? `[${code}] ` : ''}${err.message}`;
}

/**
 * What to log for an error: its code when it has one, then its stack (which starts with its message).
 * The error object itself is never given to the console, which would print every property it carries:
 * a mysql2 error carries the failed statement with its values written in (`sql`), and those can include
 * a password hash.
 */
export function describeError(err: unknown, context?: string): string {
  const lead = context ? `${context}: ` : '';
  if (!(err instanceof Error)) return `${lead}${String(err)}`;
  const code = (err as { code?: unknown }).code;
  return `${lead}${typeof code === 'string' ? `[${code}] ` : ''}${err.stack ?? `${err.name}: ${err.message}`}`;
}

/** Logs an unexpected error (see `describeError`); `context` says what was being done. */
export function logError(err: unknown, context?: string): void {
  console.error(describeError(err, context));
}
