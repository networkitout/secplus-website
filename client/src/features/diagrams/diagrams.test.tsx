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

/** On the 320-unit canvas a label under 10 units is under about 10 px on a 360 px screen. */
function expectLegibleText(root: HTMLElement) {
  const labels = [...root.querySelectorAll('text')];
  expect(labels.length).toBeGreaterThan(0);
  for (const label of labels) {
    expect(Number(label.getAttribute('font-size')), `font size of "${label.textContent}"`).toBeGreaterThanOrEqual(10);
  }
}

/** The outline colour of the box that holds the given words: the accent colour marks the current step's boxes. */
function outlineOf(root: HTMLElement, words: string): string | null {
  const label = [...root.querySelectorAll('text')].find((t) => t.textContent === words);
  expect(label, `box "${words}"`).toBeDefined();
  return label!.previousElementSibling!.getAttribute('stroke');
}

/** Whether the group that fades a part in and out is showing it. */
const shown = (el: Element) => (el.closest('g[style]') as SVGGElement | null)?.style.opacity !== '0';

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
        expectLegibleText(image());
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

const Matrix = DIAGRAMS['control-types-matrix'];
const ZeroTrust = DIAGRAMS['zero-trust-planes'];

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
    // The overview uses the lesson's wording for what a type is.
    expect(steps[0]!.text).toContain('what the control does about an incident');
  });

  it('control-types-matrix: the preventive managerial example is an approval, not a document that "requires" something', async () => {
    render(<Matrix />);
    await userEvent.click(button('Next'));
    expect(image()).toHaveAttribute('aria-label', 'Preventive controls');
    // A policy that requires something is a directive control in lesson 1.1, so it cannot be the example here.
    expect(within(image()).getByText('Manager approves access before it is granted')).toBeInTheDocument();
    expect(live().textContent).toContain('Managerial: a manager must approve each request for access before it is granted.');
    expect(image().textContent + live().textContent!).not.toMatch(/requires|policy/i);
  });

  it('control-types-matrix: no cell relies on a guard, and the compensating examples stand in for a control that cannot be used', async () => {
    const steps = await walk('control-types-matrix');
    const all = steps.map((s) => s.text).join(' ');
    expect(all).not.toMatch(/guard/i);
    expect(steps[5]!.text).toContain('a firm with one bookkeeper cannot separate duties, so the owner checks the bank statement against the invoices every week');
    expect(steps[6]!.text).toContain('a sign that says "All visitors must sign in at reception"');
  });

  it('zero-trust-planes: threat scope reduction is shown in the control plane, at the policy engine', async () => {
    render(<ZeroTrust />);
    for (let n = 0; n < 5; n++) await userEvent.click(button('Next'));
    expect(image()).toHaveAttribute('aria-label', 'Control plane: threat scope reduction');
    expect(live().textContent).toContain('CompTIA lists it under the control plane');

    const label = within(image()).getByText('least access per session');
    expect(shown(label)).toBe(true);
    expect(label.closest('[data-plane]')).toHaveAttribute('data-plane', 'control');
    // The policy engine is the highlighted part; nothing in the data plane is.
    expect(outlineOf(image(), 'Policyengine')).toBe('var(--accent)');
    for (const box of ['Subject/system', 'Enforcementpoint (PEP)', 'Resource']) expect(outlineOf(image(), box)).toBe('var(--muted)');
    const dataPlane = image().querySelector('[data-plane="data"]')!;
    expect(dataPlane.textContent).not.toMatch(/least access|per session/);
    expect([...dataPlane.querySelectorAll('[stroke="var(--accent)"]')].filter(shown)).toHaveLength(0);

    // Before that step the label is not shown.
    await userEvent.click(button('Back'));
    expect(shown(within(image()).getByText('least access per session'))).toBe(false);
  });

  it('zero-trust-planes: uses the objective\'s terms and names every control-plane idea in the control plane', async () => {
    const steps = await walk('zero-trust-planes');
    expect(steps.map((s) => s.title)).toEqual([
      'Never trust, always verify',
      'Data plane: subject/system, enforcement point, resource',
      'Control plane: the policy engine decides',
      'Control plane: the policy administrator acts',
      'Control plane: adaptive identity',
      'Control plane: threat scope reduction',
      'Data plane: implicit trust zone',
    ]);
    expect(steps[2]!.text).toContain('policy-driven access control');
    expect(steps.map((s) => s.text).join(' ')).not.toMatch(/policy decision point|to shut/);
  });

  it('aaa-flow: names the stages with the nouns the exam uses', async () => {
    const steps = await walk('aaa-flow');
    expect(steps.slice(1, 5).map((s) => s.title)).toEqual([
      'Identification: claim an identity', 'Authentication: prove the claim', 'Authorization: decide what is allowed', 'Accounting: record what happened',
    ]);
    for (const stage of ['1 Identification', '2 Authentication', '3 Authorization', '4 Accounting']) {
      expect(within(image()).getByText(stage)).toBeInTheDocument();
    }
    expect(steps.map((s) => s.text).join(' ')).not.toMatch(/TACACS/);
  });

  it('symmetric-vs-asymmetric: the sender is Priya and the recipient is Marcus, as in the lesson', async () => {
    const steps = await walk('symmetric-vs-asymmetric');
    const all = steps.map((s) => s.text).join(' ');
    expect(all).not.toMatch(/Alice|Bob/);
    expect(steps[3]!.text).toContain("Priya encrypts it with Marcus's public key. Only Marcus's private key can decrypt it");
    expect(within(image()).getByText('Priya')).toBeInTheDocument();
    expect(within(image()).getByText('Marcus')).toBeInTheDocument();
  });

  it('hashing-salting: names all four key-stretching functions and shows the salt stored with the hash', async () => {
    const steps = await walk('hashing-salting');
    expect(steps[4]!.text).toContain('Functions such as bcrypt, PBKDF2, scrypt and Argon2 do this');
    expect(within(image()).getByText('each guess is slow (bcrypt, PBKDF2, scrypt, Argon2)')).toBeInTheDocument();
    expect(within(image()).getByText('stored salt + hash')).toBeInTheDocument();
    expect(within(image()).getByText('k9Qz : 6308…82e3')).toBeInTheDocument();
  });

  it('pki-trust-chain: the request is signed with the new private key, and a root certificate is self-signed too', async () => {
    const steps = await walk('pki-trust-chain');
    expect(steps[0]!.text).toContain('it is the root of trust');
    expect(steps[1]!.text).toContain('The request is signed with the new private key, which shows that the applicant holds it.');
    expect(steps[5]!.text).toContain("A root CA's certificate is itself self-signed; it is trusted only because it is preinstalled in the trust store.");
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
      'Key exchange (TLS 1.2)', 'Session keys, Finished (TLS 1.2)', 'Encrypted data (TLS 1.2)',
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
