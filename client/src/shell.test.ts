import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const client = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('the page the app is loaded in', () => {
  it('names an icon of its own, so that no browser asks for /favicon.ico and gets the app instead', () => {
    const html = readFileSync(join(client, 'index.html'), 'utf8');
    expect(html).toContain('<link rel="icon" type="image/svg+xml" href="/favicon.svg" />');

    // Vite copies `public/` to the root of the build as it is.
    const icon = join(client, 'public', 'favicon.svg');
    expect(existsSync(icon)).toBe(true);
    const svg = readFileSync(icon, 'utf8');
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 32 32">/);
    // Nothing the content security policy would have to allow: no script, no style, nothing from elsewhere.
    expect(svg).not.toMatch(/<script|<style|style=|href=|url\(/);
  });
});
