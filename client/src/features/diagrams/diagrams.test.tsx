import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { DIAGRAM_NAMES } from '../../../../shared/diagrams';
import { DIAGRAMS } from './registry';
import { StepDiagram, type DiagramStep } from './StepDiagram';

const button = (name: string) => screen.getByRole('button', { name });
const counter = () => screen.getByText(/^Step \d+ of \d+$/).textContent!;
const image = () => screen.getByRole('img');

/** The polite live region that holds the current step's text. */
function live(): HTMLElement {
  const region = document.querySelector<HTMLElement>('[aria-live="polite"]');
  expect(region).not.toBeNull();
  return region!;
}

const PAINT = /^(none|currentColor|var\(--(bg|surface|border|text|muted|accent|on-accent|ok|bad|warn)\))$/;

/** Every colour in the drawing must come from a design token (or inherit). */
function expectTokenColours(root: HTMLElement) {
  for (const el of root.querySelectorAll('*')) {
    for (const attr of ['fill', 'stroke', 'stop-color', 'color']) {
      const value = el.getAttribute(attr);
      if (value !== null) expect(value, `${attr} on <${el.tagName}>`).toMatch(PAINT);
    }
    const style = el.getAttribute('style') ?? '';
    expect(style, `style on <${el.tagName}>`).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
  }
}

describe('diagrams', () => {
  it('registers exactly the names in DIAGRAM_NAMES', () => {
    expect(Object.keys(DIAGRAMS).sort()).toEqual([...DIAGRAM_NAMES].sort());
  });

  it.each(DIAGRAM_NAMES)(
    'every name in DIAGRAM_NAMES has a registered component that renders, has 4–8 steps, and Next/Back update "Step n of N" and the live description: %s',
    async (name) => {
      const Diagram = DIAGRAMS[name];
      render(<Diagram />);

      const total = Number(/^Step 1 of (\d+)$/.exec(counter())![1]);
      expect(total).toBeGreaterThanOrEqual(4);
      expect(total).toBeLessThanOrEqual(8);
      expect(screen.getByRole('group')).toHaveAccessibleName(/\w{3,}/);

      const seen: { title: string; text: string }[] = [];
      for (let n = 1; n <= total; n++) {
        expect(counter()).toBe(`Step ${n} of ${total}`);
        const title = image().getAttribute('aria-label')!;
        const text = live().textContent!;
        expect(title.trim().length).toBeGreaterThan(3);
        expect(text).toContain(title);
        expect(text.length).toBeGreaterThan(title.length + 60);
        expect(image().querySelector('svg[viewBox]')).not.toBeNull();
        expectTokenColours(image());
        seen.push({ title, text });
        if (n < total) await userEvent.click(button('Next'));
      }
      expect(new Set(seen.map((s) => s.title)).size).toBe(total);
      expect(new Set(seen.map((s) => s.text)).size).toBe(total);

      // Next does nothing more on the last step.
      expect(button('Next')).toHaveAttribute('aria-disabled', 'true');
      await userEvent.click(button('Next'));
      expect(counter()).toBe(`Step ${total} of ${total}`);

      await userEvent.click(button('Back'));
      expect(counter()).toBe(`Step ${total - 1} of ${total}`);
      expect(live().textContent).toBe(seen[total - 2]!.text);
      expect(image()).toHaveAttribute('aria-label', seen[total - 2]!.title);

      await userEvent.click(button('Replay'));
      expect(counter()).toBe(`Step 1 of ${total}`);
      expect(live().textContent).toBe(seen[0]!.text);
    },
  );
});

/** Renders a registered diagram and walks it from the first step to the last. */
async function walk(name: (typeof DIAGRAM_NAMES)[number]) {
  const Diagram = DIAGRAMS[name];
  render(<Diagram />);
  const total = Number(/of (\d+)$/.exec(counter())![1]);
  const steps: { title: string; text: string }[] = [];
  for (let n = 1; n <= total; n++) {
    steps.push({ title: image().getAttribute('aria-label')!, text: live().textContent! });
    if (n < total) await userEvent.click(button('Next'));
  }
  return steps;
}

describe('diagram content', () => {
  it('control-types-matrix: every type step names one example for each of the four categories', async () => {
    const steps = await walk('control-types-matrix');
    expect(steps.slice(1).map((s) => s.title)).toEqual([
      'Preventive controls', 'Deterrent controls', 'Detective controls', 'Corrective controls', 'Compensating controls', 'Directive controls',
    ]);
    for (const step of steps.slice(1)) {
      expect(step.text).toMatch(/Technical: .+ Managerial: .+ Operational: .+ Physical: .+/);
    }
  });

  it('change-management-flow: the change is tested before it is approved', async () => {
    const steps = await walk('change-management-flow');
    expect(steps.map((s) => s.title)).toEqual([
      'Request', 'Impact analysis', 'Test', 'Approval', 'Maintenance window', 'Implement', 'Verify or back out', 'Update documentation',
    ]);
    expect(steps[3]!.text).toContain('Some organizations approve the change first and then test it before go-live.');
    expect(steps[4]!.text).toContain('The window is proposed in the request and approved with it.');
  });

  it('tls-handshake: is labelled as the TLS 1.2 message order and says how TLS 1.3 differs', async () => {
    const steps = await walk('tls-handshake');
    expect(screen.getByRole('group')).toHaveAccessibleName(/TLS 1\.2/);
    expect(steps.map((s) => s.title)).toEqual([
      'Client Hello (TLS 1.2)', 'Server Hello and cipher choice (TLS 1.2)', 'Certificate (TLS 1.2)',
      'Key exchange (TLS 1.2)', 'Session keys (TLS 1.2)', 'Encrypted data (TLS 1.2)',
    ]);
    const all = steps.map((s) => s.text).join(' ');
    expect(all).toContain('TLS 1.3 sends the key share in the hello messages, before the certificate, and finishes in one round trip.');
    // RSA key transport may only appear as the method that TLS 1.3 removed.
    expect(all).toMatch(/older method[^.]*RSA public key[^.]*TLS 1\.3 removed it in favor of ephemeral Diffie-Hellman\./);
  });
});

describe('StepDiagram', () => {
  const steps: DiagramStep[] = [
    { title: 'First', description: 'The first thing happens.' },
    { title: 'Second', description: 'The second thing happens.' },
    { title: 'Third', description: 'The third thing happens.' },
  ];

  function renderDiagram() {
    return render(
      <StepDiagram
        title="Three things"
        steps={steps}
        render={(i) => (
          <svg viewBox="0 0 10 10">
            <text>{`drawing ${i}`}</text>
          </svg>
        )}
      />,
    );
  }

  it('shows the title, the step count, the drawing for the step and its text in a polite live region', () => {
    renderDiagram();
    expect(screen.getByRole('group', { name: 'Three things' })).toBeInTheDocument();
    expect(screen.getByText('Step 1 of 3')).toBeInTheDocument();
    expect(image()).toHaveAttribute('aria-label', 'First');
    expect(within(image()).getByText('drawing 0')).toBeInTheDocument();
    expect(live()).toHaveTextContent('First');
    expect(live()).toHaveTextContent('The first thing happens.');
  });

  it('Next and Back move one step and stop at the ends without losing keyboard focus', async () => {
    renderDiagram();
    // Unavailable buttons stay focusable, so a keyboard user is never dropped out of the controls.
    expect(button('Back')).toHaveAttribute('aria-disabled', 'true');
    expect(button('Back')).toBeEnabled();
    await userEvent.click(button('Back'));
    expect(screen.getByText('Step 1 of 3')).toBeInTheDocument();

    button('Next').focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByText('Step 2 of 3')).toBeInTheDocument();
    expect(image()).toHaveAttribute('aria-label', 'Second');
    expect(within(image()).getByText('drawing 1')).toBeInTheDocument();
    expect(live()).toHaveTextContent('The second thing happens.');
    expect(button('Back')).not.toHaveAttribute('aria-disabled');

    await userEvent.keyboard(' ');
    expect(screen.getByText('Step 3 of 3')).toBeInTheDocument();
    expect(button('Next')).toHaveAttribute('aria-disabled', 'true');
    expect(button('Next')).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByText('Step 3 of 3')).toBeInTheDocument();

    await userEvent.click(button('Back'));
    expect(screen.getByText('Step 2 of 3')).toBeInTheDocument();
    expect(live()).toHaveTextContent('The second thing happens.');
  });

  it('Replay returns to the first step', async () => {
    renderDiagram();
    await userEvent.click(button('Next'));
    await userEvent.click(button('Next'));
    await userEvent.click(button('Replay'));
    expect(screen.getByText('Step 1 of 3')).toBeInTheDocument();
    expect(image()).toHaveAttribute('aria-label', 'First');
    expect(live()).toHaveTextContent('The first thing happens.');
  });
});
