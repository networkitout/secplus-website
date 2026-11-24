import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'styles.css'), 'utf8');

/** The tokens of one theme: the declarations of the rule with this selector. */
function tokens(selector: string): Record<string, string> {
  const at = css.indexOf(`${selector} {`);
  expect(at, `no rule for ${selector}`).toBeGreaterThanOrEqual(0);
  const body = css.slice(at, css.indexOf('}', at));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1]!, m[2]!]));
}

/** Relative luminance of a `#rrggbb` colour, as WCAG defines it. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

describe('design tokens', () => {
  // WCAG 1.4.11: the edge of a text field or a menu is what shows that it is one.
  it.each([
    ['dark', ':root'],
    ['light', "[data-theme='light']"],
  ])('%s theme: the border of a form field has at least 3:1 against the page and against a card', (_theme, selector) => {
    const t = tokens(selector);
    expect(t['--field-border']).toBeDefined();
    expect(contrast(t['--field-border']!, t['--bg']!)).toBeGreaterThanOrEqual(3);
    expect(contrast(t['--field-border']!, t['--surface']!)).toBeGreaterThanOrEqual(3);
  });

  it('the field border is a colour of the Tailwind theme', () => {
    expect(css).toContain('--color-field-border: var(--field-border);');
  });
});
