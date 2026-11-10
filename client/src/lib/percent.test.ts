import { describe, expect, it } from 'vitest';
import { wholePercent } from './percent';

describe('wholePercent', () => {
  it('is whole and never rounded up, and a whole value is not lost to floating point', () => {
    expect(wholePercent(79.99)).toBe(79);
    expect(wholePercent((2 / 3) * 100)).toBe(66);
    expect(wholePercent(100)).toBe(100);
    expect(0.29 * 100).toBeLessThan(29); // the case the allowance is for
    expect(wholePercent(0.29 * 100)).toBe(29);
    expect(wholePercent(0)).toBe(0);
  });
});
