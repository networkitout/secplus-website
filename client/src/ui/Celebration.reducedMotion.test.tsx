import { render, screen } from '@testing-library/react';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { Celebration } from './Celebration';

// Motion reads the reduced-motion preference once per module instance, so this case has its own file.
beforeAll(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  // In development Motion logs a notice when the device prefers reduced motion; here that is expected.
  const warn = console.warn;
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    if (!String(args[0]).includes('Reduced Motion')) warn(...args);
  });
});
afterAll(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('Celebration renders a static banner under reduced motion', () => {
  render(<Celebration kind="level-up" title="Level 4" detail="Keep going" onDone={() => {}} />);
  const banner = screen.getByRole('status');
  expect(banner).toHaveTextContent('Level 4');
  expect(banner).toHaveTextContent('Keep going');
  expect(banner).not.toHaveAttribute('style'); // no entrance animation
  expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
});
