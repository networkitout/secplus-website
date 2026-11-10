/**
 * A score or a share as a whole percentage for display. Always rounded down, so that nothing reads as more
 * than was scored (79.99 is 79%, two thirds is 66%). The small allowance keeps a value that is a whole
 * number, but not exactly so in floating point (0.29 × 100), from losing a point.
 */
export function wholePercent(pct: number): number {
  return Math.floor(pct + 1e-9);
}
