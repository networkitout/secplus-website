import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { FlashcardView } from './FlashcardView';

const MOTION_NOTICE = 'You have Reduced Motion enabled on your device. Animations may not appear as expected.';

// Motion reads the reduced-motion preference once per module instance, so this case has its own file.
beforeAll(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  // Motion logs exactly one notice in development when the device prefers reduced motion (`useReducedMotion`
  // and every motion element report it through one `warnOnce`). It cannot be switched off, and here it is the
  // expected state, so that one message is let through silently; any other warning still reaches the console.
  const warn = console.warn;
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    if (!String(args[0]).startsWith(MOTION_NOTICE)) warn(...args);
  });
});
afterAll(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function Card() {
  const [definition, setDefinition] = useState<string | null>(null);
  return (
    <FlashcardView
      term="Security control"
      definition={definition}
      onReveal={() => setDefinition('A measure put in place to reduce risk.')}
      onGrade={() => {}}
    />
  );
}

it('under reduced motion the card does not turn: the answer fades in over the term', async () => {
  render(<Card />);
  const card = screen.getByRole('group', { name: 'Flashcard' });
  expect(card.innerHTML).not.toContain('rotate');

  await userEvent.click(screen.getByRole('button', { name: 'Show answer' }));
  const definition = await screen.findByText('A measure put in place to reduce risk.');
  expect(definition).toHaveFocus();
  // The side with the answer ends fully opaque; nothing on the card is rotated at any point.
  await waitFor(() => expect(definition.closest<HTMLElement>('[data-face="back"]')!.style.opacity).toBe('1'));
  expect(card.innerHTML).not.toContain('rotate');
  expect(screen.getByRole('button', { name: 'I knew it' })).toBeInTheDocument();
});
