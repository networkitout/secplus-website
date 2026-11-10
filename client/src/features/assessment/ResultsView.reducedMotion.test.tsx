import { render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createQueryClient } from '../../queryClient';
import { ResultsView } from './ResultsView';

// Motion reads the reduced-motion preference once per module instance, so this case has its own file.
beforeAll(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ domains: [] }), { status: 200 })));
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

it('the score ring is drawn at its final value, without animation, under reduced motion', () => {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <ResultsView
        result={{ scorePct: 75, passed: true, byDomain: {}, byObjective: {}, xp: 0, newBadges: [] }}
        questions={[]}
        answers={{}}
        feedback={{}}
      />
    </QueryClientProvider>,
  );
  const arc = screen.getByRole('img', { name: 'Score: 75%' }).querySelectorAll('circle')[1]!;
  const length = Number(arc.getAttribute('stroke-dasharray'));
  // Three quarters of the ring are filled on the very first paint.
  expect(Number(arc.getAttribute('stroke-dashoffset'))).toBeCloseTo(length / 4);
  expect(arc).not.toHaveAttribute('style');
});
