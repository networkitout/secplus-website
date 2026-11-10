import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Answer, Feedback, PublicQuestion } from '../../../../shared/types';
import { initialAnswer, isComplete, QuestionView } from './QuestionView';

/**
 * jsdom has no `matchMedia`. This stands in for the system "reduce motion" setting, and tells whoever is
 * listening when a test changes it, the way a browser does. It is installed before Motion first reads it.
 */
const motionPreference = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const reducedMotion = {
    matches: false,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  };
  const other = { matches: false, addEventListener: () => {}, removeEventListener: () => {} };
  window.matchMedia = ((query: string) =>
    query.includes('prefers-reduced-motion') ? reducedMotion : other) as unknown as typeof window.matchMedia;
  return {
    set(reduce: boolean) {
      reducedMotion.matches = reduce;
      for (const listener of listeners) listener();
    },
  };
});

const base = { objective: '1.1', difficulty: 1 as const };

const single: PublicQuestion = {
  ...base, id: 'q-1.1-001', type: 'single',
  prompt: 'Which control category does a firewall rule belong to?',
  options: [
    { id: 'a', text: 'Technical' },
    { id: 'b', text: 'Managerial' },
    { id: 'c', text: 'Operational' },
    { id: 'd', text: 'Physical' },
  ],
};

const multi: PublicQuestion = {
  ...base, id: 'q-1.1-002', type: 'multi',
  prompt: 'Which of these are physical controls? (Choose two.)',
  options: [
    { id: 'a', text: 'Bollards' },
    { id: 'b', text: 'Access policy' },
    { id: 'c', text: 'Door lock' },
    { id: 'd', text: 'Log review' },
  ],
};

const order: PublicQuestion = {
  ...base, id: 'q-1.1-003', type: 'order',
  prompt: 'Put the change steps in order.',
  items: [
    { id: 'a', text: 'Request' },
    { id: 'b', text: 'Approve' },
    { id: 'c', text: 'Implement' },
  ],
};

const match: PublicQuestion = {
  ...base, id: 'q-1.1-004', type: 'match',
  prompt: 'Match each goal to its control.',
  left: [
    { id: 'l1', text: 'Confidentiality' },
    { id: 'l2', text: 'Integrity' },
  ],
  right: [
    { id: 'r1', text: 'Encryption' },
    { id: 'r2', text: 'Hashing' },
  ],
};

const categorize: PublicQuestion = {
  ...base, id: 'q-1.1-005', type: 'categorize',
  prompt: 'Sort each control into its type.',
  items: [
    { id: 'i1', text: 'Fence' },
    { id: 'i2', text: 'Audit log' },
  ],
  buckets: [
    { id: 'b1', text: 'Preventive' },
    { id: 'b2', text: 'Detective' },
  ],
};

/** Holds the answer the way a real screen does, so the controlled component re-renders with each change. */
function Harness({
  question,
  initial = null,
  onChange,
}: {
  question: PublicQuestion;
  initial?: Answer | null;
  onChange?: (a: Answer) => void;
}) {
  const [value, setValue] = useState<Answer | null>(initial);
  return (
    <QuestionView
      question={question}
      value={value}
      onChange={(a) => {
        setValue(a);
        onChange?.(a);
      }}
    />
  );
}

type Box = { x: number; y: number; width: number; height: number };

/** jsdom has no layout, so dnd-kit sees every box as empty. Give the elements it measures real boxes. */
function stubLayout(boxFor: (el: HTMLElement) => Box | undefined) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const { x, y, width, height } = boxFor(this) ?? { x: 0, y: 0, width: 0, height: 0 };
    const rect = { x, y, width, height, left: x, top: y, right: x + width, bottom: y + height };
    return { ...rect, toJSON: () => rect };
  });
}

/** A mouse drag from the centre of one box to the centre of another, in the steps dnd-kit needs to track it. */
function mouseDrag(source: HTMLElement, from: Box, to: Box) {
  const centre = (b: Box) => ({ clientX: b.x + b.width / 2, clientY: b.y + b.height / 2 });
  fireEvent.mouseDown(source, { button: 0, ...centre(from) });
  fireEvent.mouseMove(document, { clientX: centre(from).clientX + 10, clientY: centre(from).clientY + 10 });
  fireEvent.mouseMove(document, centre(to));
  fireEvent.mouseUp(document, centre(to));
}

/**
 * Checks the marking attached to a control: the icon a sighted learner sees beside it, and the words a
 * screen reader reads for it (the icon is decorative, so it is not part of the description).
 */
function expectMarking(control: HTMLElement, icon: '✓' | '✗', description: RegExp) {
  const marking = document.getElementById(control.getAttribute('aria-describedby') ?? '');
  expect(marking).toHaveTextContent(new RegExp(`^${icon}`));
  expect(control).toHaveAccessibleDescription(description);
}

const rowTexts = () => screen.getAllByRole('listitem').map((row) => row.querySelector('p')?.textContent);

afterEach(() => {
  vi.restoreAllMocks();
  motionPreference.set(false);
});

describe('questions', () => {
  it('single: clicking an option calls onChange({type:"single", choice})', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness question={single} onChange={onChange} />);

    const group = screen.getByRole('radiogroup', { name: single.prompt });
    expect(within(group).getAllByRole('radio')).toHaveLength(4);
    await user.click(screen.getByRole('radio', { name: 'Managerial' }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ type: 'single', choice: 'b' });
    expect(screen.getByRole('radio', { name: 'Managerial' })).toBeChecked();
  });

  it('single: arrow keys move selection within the radio group', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness question={single} initial={{ type: 'single', choice: 'a' }} onChange={onChange} />);

    await user.tab();
    expect(screen.getByRole('radio', { name: 'Technical' })).toHaveFocus();

    await user.keyboard('{ArrowDown}');
    expect(onChange).toHaveBeenLastCalledWith({ type: 'single', choice: 'b' });
    expect(screen.getByRole('radio', { name: 'Managerial' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Managerial' })).toHaveFocus();

    await user.keyboard('{ArrowUp}');
    expect(onChange).toHaveBeenLastCalledWith({ type: 'single', choice: 'a' });
    expect(screen.getByRole('radio', { name: 'Technical' })).toBeChecked();
  });

  it('multi: toggling builds choices; untoggling removes', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness question={multi} onChange={onChange} />);

    expect(within(screen.getByRole('group', { name: multi.prompt })).getAllByRole('checkbox')).toHaveLength(4);

    await user.click(screen.getByRole('checkbox', { name: 'Door lock' }));
    expect(onChange).toHaveBeenLastCalledWith({ type: 'multi', choices: ['c'] });

    await user.click(screen.getByRole('checkbox', { name: 'Bollards' }));
    expect(onChange).toHaveBeenLastCalledWith({ type: 'multi', choices: ['a', 'c'] });
    expect(screen.getByRole('checkbox', { name: 'Bollards' })).toBeChecked();

    await user.click(screen.getByRole('checkbox', { name: 'Door lock' }));
    expect(onChange).toHaveBeenLastCalledWith({ type: 'multi', choices: ['a'] });
    expect(screen.getByRole('checkbox', { name: 'Door lock' })).not.toBeChecked();
  });

  it('multi: shows a "Choose N" hint only when the prompt states the number', () => {
    const { unmount } = render(<Harness question={multi} />);
    expect(screen.getByText('Choose 2')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: multi.prompt })).toHaveAccessibleDescription('Choose 2');
    unmount();

    render(<Harness question={{ ...multi, prompt: 'Which of these are physical controls?' }} />);
    expect(screen.queryByText(/^Choose/)).not.toBeInTheDocument();
  });

  it('order: shows the served item order and emits nothing until the learner acts', () => {
    const onChange = vi.fn();
    const { unmount } = render(<Harness question={order} onChange={onChange} />);

    expect(within(screen.getByRole('list', { name: order.prompt })).getAllByRole('listitem')).toHaveLength(3);
    expect(rowTexts()).toEqual(['Request', 'Approve', 'Implement']);
    expect(onChange).not.toHaveBeenCalled();
    unmount();

    // Showing a question is never a write, including under the double mount of development builds.
    render(
      <StrictMode>
        <Harness question={order} onChange={onChange} />
      </StrictMode>,
    );
    expect(rowTexts()).toEqual(['Request', 'Approve', 'Implement']);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('initialAnswer is the served order for an order question and null for every other type', () => {
    expect(initialAnswer(order)).toEqual({ type: 'order', order: ['a', 'b', 'c'] });
    for (const question of [single, multi, match, categorize]) expect(initialAnswer(question)).toBeNull();
  });

  it('order: "Move down" on the first item emits the swapped order; first item has no enabled "Move up"', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness question={order} onChange={onChange} />);

    expect(screen.getByRole('button', { name: 'Move up: Request' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move down: Implement' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Move down: Request' }));

    expect(onChange).toHaveBeenLastCalledWith({ type: 'order', order: ['b', 'a', 'c'] });
    const rows = screen.getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Approve');
    expect(rows[1]).toHaveTextContent('Request');
    expect(screen.getByRole('button', { name: 'Move up: Request' })).toBeEnabled();
    expect(screen.getByText('Request moved to position 2 of 3.')).toBeInTheDocument();
  });

  it('order: keeps keyboard focus on the item when a move disables the pressed button', async () => {
    const user = userEvent.setup();
    render(<Harness question={order} />);

    const down = screen.getByRole('button', { name: 'Move down: Approve' });
    down.focus();
    await user.keyboard('{Enter}');

    expect(down).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move up: Approve' })).toHaveFocus();
  });

  it('order: keyboard drag (Space, ArrowDown, Space) emits the swapped order', async () => {
    stubLayout((el) => {
      const row = el.closest('li');
      if (!row?.parentElement) return undefined;
      return { x: 0, y: Array.from(row.parentElement.children).indexOf(row) * 50, width: 300, height: 40 };
    });
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness question={order} onChange={onChange} />);

    screen.getByRole('button', { name: 'Reorder: Request' }).focus();
    await user.keyboard('[Space]');
    await user.keyboard('{ArrowDown}');
    await user.keyboard('[Space]');

    expect(onChange).toHaveBeenLastCalledWith({ type: 'order', order: ['b', 'a', 'c'] });
    expect(screen.getAllByRole('listitem')[1]).toHaveTextContent('Request');
    expect(screen.getByText('Request dropped at position 2 of 3.')).toBeInTheDocument();
  });

  it('match: choosing from the select emits pairs; choosing a right item already used moves it', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness question={match} onChange={onChange} />);

    const confidentiality = screen.getByRole('combobox', { name: 'Match for Confidentiality' });
    const integrity = screen.getByRole('combobox', { name: 'Match for Integrity' });

    await user.selectOptions(confidentiality, 'Encryption');
    expect(onChange).toHaveBeenLastCalledWith({ type: 'match', pairs: { l1: 'r1' } });
    expect(confidentiality).toHaveValue('r1');

    const moved = 'Encryption moved to Integrity. Confidentiality has no match.';
    expect(screen.queryByText(moved)).not.toBeInTheDocument();

    await user.selectOptions(integrity, 'Encryption');
    expect(onChange).toHaveBeenLastCalledWith({ type: 'match', pairs: { l2: 'r1' } });
    expect(confidentiality).toHaveValue('');
    expect(integrity).toHaveValue('r1');
    // The row that lost its pair is not the one in focus, so the loss is announced.
    expect(screen.getByText(moved)).toHaveAttribute('aria-live', 'polite');

    await user.selectOptions(confidentiality, 'Hashing');
    expect(onChange).toHaveBeenLastCalledWith({ type: 'match', pairs: { l1: 'r2', l2: 'r1' } });
    expect(screen.queryByText(moved)).not.toBeInTheDocument();

    await user.selectOptions(integrity, '');
    expect(onChange).toHaveBeenLastCalledWith({ type: 'match', pairs: { l1: 'r2' } });
  });

  it('match: dragging an answer onto a left item pairs them, taking it from the row that had it; a drop on its own row emits nothing', () => {
    const boxes = new Map<Element, Box>();
    stubLayout((el) => boxes.get(el));
    const onChange = vi.fn();
    render(<Harness question={match} initial={{ type: 'match', pairs: { l1: 'r2' } }} onChange={onChange} />);

    const chip = screen.getByText('Hashing', { ignore: 'option' });
    const target = screen.getByRole('combobox', { name: 'Match for Integrity' }).closest('li')!;
    const from = { x: 0, y: 300, width: 100, height: 30 };
    const to = { x: 0, y: 60, width: 300, height: 50 };
    boxes.set(chip, from);
    boxes.set(target, to);
    boxes.set(screen.getByRole('combobox', { name: 'Match for Confidentiality' }).closest('li')!, { x: 0, y: 0, width: 300, height: 50 });

    mouseDrag(chip, from, to);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith({ type: 'match', pairs: { l2: 'r2' } });
    expect(screen.getByRole('combobox', { name: 'Match for Integrity' })).toHaveValue('r2');
    expect(screen.getByRole('combobox', { name: 'Match for Confidentiality' })).toHaveValue('');
    expect(screen.getByText('Hashing moved to Integrity. Confidentiality has no match.')).toBeInTheDocument();

    mouseDrag(chip, from, to);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('combobox', { name: 'Match for Integrity' })).toHaveValue('r2');
  });

  it('categorize: select emits placements; isComplete false until every item is placed', async () => {
    const user = userEvent.setup();
    const answers: Answer[] = [];
    render(<Harness question={categorize} onChange={(a) => answers.push(a)} />);

    expect(isComplete(categorize, null)).toBe(false);
    const unplaced = screen.getByRole('group', { name: 'Not placed yet' });
    expect(within(unplaced).getByText('Fence')).toBeInTheDocument();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Bucket for Fence' }), 'Preventive');
    expect(answers.at(-1)).toEqual({ type: 'categorize', placements: { i1: 'b1' } });
    expect(isComplete(categorize, answers.at(-1)!)).toBe(false);
    expect(within(screen.getByRole('group', { name: 'Preventive' })).getByText('Fence')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Bucket for Fence' })).toHaveFocus();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Bucket for Audit log' }), 'Detective');
    expect(answers.at(-1)).toEqual({ type: 'categorize', placements: { i1: 'b1', i2: 'b2' } });
    expect(isComplete(categorize, answers.at(-1)!)).toBe(true);

    await user.selectOptions(screen.getByRole('combobox', { name: 'Bucket for Fence' }), '');
    expect(answers.at(-1)).toEqual({ type: 'categorize', placements: { i2: 'b2' } });
    expect(isComplete(categorize, answers.at(-1)!)).toBe(false);
  });

  it('categorize: dragging an item into a bucket places it', () => {
    const boxes = new Map<Element, Box>();
    stubLayout((el) => boxes.get(el));
    const onChange = vi.fn();
    render(<Harness question={categorize} onChange={onChange} />);

    const item = screen.getByText('Audit log');
    const from = { x: 0, y: 0, width: 100, height: 30 };
    const to = { x: 200, y: 100, width: 150, height: 120 };
    boxes.set(item, from);
    boxes.set(screen.getByRole('group', { name: 'Not placed yet' }), { x: 0, y: 0, width: 400, height: 80 });
    boxes.set(screen.getByRole('group', { name: 'Preventive' }), { x: 0, y: 100, width: 150, height: 120 });
    boxes.set(screen.getByRole('group', { name: 'Detective' }), to);

    mouseDrag(item, from, to);

    expect(onChange).toHaveBeenLastCalledWith({ type: 'categorize', placements: { i2: 'b2' } });
    expect(within(screen.getByRole('group', { name: 'Detective' })).getByText('Audit log')).toBeInTheDocument();
  });

  it('with feedback: inputs are disabled, correct answer is marked, explanation and per-option why are shown, status announced via role="status"', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const feedback: Feedback = {
      correct: false,
      fraction: 0,
      correctAnswer: { type: 'single', choice: 'a' },
      explanation: 'Firewall rules are enforced by technology, so they are technical controls.',
      why: {
        a: 'A firewall enforces its rules in software or hardware.',
        b: 'Managerial controls are policies and risk decisions.',
        c: 'Operational controls are carried out by people.',
        d: 'Physical controls restrict access to places.',
      },
    };
    const answer: Answer = { type: 'single', choice: 'b' };
    const { rerender } = render(<QuestionView question={single} value={answer} onChange={onChange} />);

    // The live region is in the page before the result arrives, so screen readers announce what is added to it.
    const status = screen.getByRole('status', { name: 'Result' });
    expect(status).toBeEmptyDOMElement();

    rerender(<QuestionView question={single} value={answer} onChange={onChange} feedback={feedback} />);

    expect(screen.getByRole('status', { name: 'Result' })).toBe(status);
    expect(status).toHaveTextContent('✗');
    expect(status).toHaveTextContent('Incorrect');
    expect(status).toHaveTextContent(feedback.explanation);

    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled();
    await user.click(screen.getByText('Operational'));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('radio', { name: 'Managerial' })).toBeChecked();

    const correct = screen.getByRole('radio', { name: 'Technical' });
    expectMarking(correct, '✓', /^Correct answer \(not chosen\)/);
    expect(correct).toHaveAccessibleDescription(/A firewall enforces its rules in software or hardware\./);
    const chosen = screen.getByRole('radio', { name: 'Managerial' });
    expectMarking(chosen, '✗', /^Incorrect \(your choice\)/);
    expect(chosen).toHaveAccessibleDescription(/Managerial controls are policies and risk decisions\./);
    expectMarking(screen.getByRole('radio', { name: 'Physical' }), '✗', /^Incorrect Physical controls restrict access to places\.$/);
    expect(screen.getByText('Operational controls are carried out by people.')).toBeInTheDocument();
  });

  it('with feedback: a correct answer is announced as correct, and multi marks missed and wrong choices', () => {
    const feedback: Feedback = {
      correct: false,
      fraction: 0,
      correctAnswer: { type: 'multi', choices: ['a', 'c'] },
      explanation: 'Bollards and locks physically stop access.',
      why: { a: 'A barrier.', b: 'A document.', c: 'A barrier to entry.', d: 'A detective activity.' },
    };
    const { unmount } = render(
      <QuestionView question={multi} value={{ type: 'multi', choices: ['a', 'b'] }} onChange={vi.fn()} feedback={feedback} />,
    );
    for (const box of screen.getAllByRole('checkbox')) expect(box).toBeDisabled();
    expectMarking(screen.getByRole('checkbox', { name: 'Bollards' }), '✓', /^Correct answer \(your choice\)/);
    expectMarking(screen.getByRole('checkbox', { name: 'Access policy' }), '✗', /^Incorrect \(your choice\)/);
    expectMarking(screen.getByRole('checkbox', { name: 'Door lock' }), '✓', /^Correct answer \(not chosen\)/);
    expectMarking(screen.getByRole('checkbox', { name: 'Log review' }), '✗', /^Incorrect\s+A detective activity\./);
    unmount();

    render(
      <QuestionView
        question={single}
        value={{ type: 'single', choice: 'a' }}
        onChange={vi.fn()}
        feedback={{ correct: true, fraction: 1, correctAnswer: { type: 'single', choice: 'a' }, explanation: 'Right.' }}
      />,
    );
    const status = screen.getByRole('status', { name: 'Result' });
    expect(status).toHaveTextContent('✓');
    expect(status).toHaveTextContent('Correct');
    expect(status).not.toHaveTextContent('Incorrect');
    expectMarking(screen.getByRole('radio', { name: 'Technical' }), '✓', /^Correct answer \(your choice\)/);
  });

  it('with feedback: order, match and categorize are locked and mark every item with an icon and a label', () => {
    const onChange = vi.fn();
    const { unmount: unmountOrder } = render(
      <QuestionView
        question={order}
        value={{ type: 'order', order: ['a', 'c', 'b'] }}
        onChange={onChange}
        feedback={{ correct: false, fraction: 1 / 3, correctAnswer: { type: 'order', order: ['a', 'b', 'c'] }, explanation: 'Approval comes before the work.' }}
      />,
    );
    const rows = screen.getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent(/✓\s*Correct position/);
    expect(rows[1]).toHaveTextContent(/✗\s*Incorrect\. Correct position: 3/);
    expect(rows[2]).toHaveTextContent(/✗\s*Incorrect\. Correct position: 2/);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    // The drag-and-drop types carry a second live region for drag announcements; the result is found by name.
    expect(screen.getAllByRole('status').length).toBeGreaterThan(1);
    expect(screen.getByRole('status', { name: 'Result' })).toHaveTextContent('Approval comes before the work.');
    unmountOrder();

    const { unmount: unmountMatch } = render(
      <QuestionView
        question={match}
        value={{ type: 'match', pairs: { l1: 'r1' } }}
        onChange={onChange}
        feedback={{ correct: false, fraction: 0.5, correctAnswer: { type: 'match', pairs: { l1: 'r1', l2: 'r2' } }, explanation: 'Hashes detect change.' }}
      />,
    );
    const confidentiality = screen.getByRole('combobox', { name: 'Match for Confidentiality' });
    const integrity = screen.getByRole('combobox', { name: 'Match for Integrity' });
    expect(confidentiality).toBeDisabled();
    expect(integrity).toBeDisabled();
    expectMarking(confidentiality, '✓', /^Correct$/);
    expectMarking(integrity, '✗', /^Incorrect\. Correct match: Hashing/);
    unmountMatch();

    render(
      <QuestionView
        question={categorize}
        value={{ type: 'categorize', placements: { i1: 'b1', i2: 'b1' } }}
        onChange={onChange}
        feedback={{ correct: false, fraction: 0.5, correctAnswer: { type: 'categorize', placements: { i1: 'b1', i2: 'b2' } }, explanation: 'Logs detect; fences prevent.' }}
      />,
    );
    const fence = screen.getByRole('combobox', { name: 'Bucket for Fence' });
    const log = screen.getByRole('combobox', { name: 'Bucket for Audit log' });
    expect(fence).toBeDisabled();
    expect(log).toBeDisabled();
    expectMarking(fence, '✓', /^Correct$/);
    expectMarking(log, '✗', /^Incorrect\. Belongs in: Detective/);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('disabled: locks every input without showing a result', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { unmount } = render(<QuestionView question={multi} value={null} onChange={onChange} disabled />);
    for (const box of screen.getAllByRole('checkbox')) expect(box).toBeDisabled();
    await user.click(screen.getByText('Bollards'));
    expect(screen.getByRole('status', { name: 'Result' })).toBeEmptyDOMElement();
    unmount();

    const orderView = render(<QuestionView question={order} value={null} onChange={onChange} disabled />);
    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled();
    orderView.unmount();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('disabled: match and categorize offer no dragging', () => {
    const boxes = new Map<Element, Box>();
    stubLayout((el) => boxes.get(el));
    const onChange = vi.fn();
    const from = { x: 0, y: 300, width: 100, height: 30 };
    const to = { x: 0, y: 60, width: 300, height: 50 };

    const open = render(<QuestionView question={match} value={null} onChange={onChange} />);
    expect(screen.getByText(/drag an answer onto its item/)).toBeInTheDocument();
    open.unmount();
    const matchView = render(<QuestionView question={match} value={null} onChange={onChange} disabled />);
    expect(screen.queryByText(/drag an answer onto its item/)).not.toBeInTheDocument();
    for (const select of screen.getAllByRole('combobox')) expect(select).toBeDisabled();
    const chip = screen.getByText('Hashing', { ignore: 'option' });
    boxes.set(chip, from);
    boxes.set(screen.getByRole('combobox', { name: 'Match for Integrity' }).closest('li')!, to);
    mouseDrag(chip, from, to);
    matchView.unmount();

    const openCategorize = render(<QuestionView question={categorize} value={null} onChange={onChange} />);
    expect(screen.getByText(/drag the item into a bucket/)).toBeInTheDocument();
    openCategorize.unmount();
    render(<QuestionView question={categorize} value={null} onChange={onChange} disabled />);
    expect(screen.queryByText(/drag the item into a bucket/)).not.toBeInTheDocument();
    for (const select of screen.getAllByRole('combobox')) expect(select).toBeDisabled();
    const item = screen.getByText('Audit log');
    boxes.set(item, from);
    boxes.set(screen.getByRole('group', { name: 'Detective' }), to);
    mouseDrag(item, from, to);

    expect(onChange).not.toHaveBeenCalled();
  });

  it('ignores ids in the value that the question does not have', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    // order: anything but an exact permutation of the items is treated as unanswered.
    for (const bad of [['a', 'x', 'c'], ['c', 'a'], ['a', 'a', 'b'], ['c', 'b', 'a', 'a']]) {
      const view = render(<QuestionView question={order} value={{ type: 'order', order: bad }} onChange={onChange} />);
      expect(rowTexts()).toEqual(['Request', 'Approve', 'Implement']);
      view.unmount();
    }
    const orderView = render(
      <QuestionView question={order} value={{ type: 'order', order: ['c', 'x', 'a'] }} onChange={onChange} />,
    );
    await user.click(screen.getByRole('button', { name: 'Move down: Request' }));
    expect(onChange).toHaveBeenLastCalledWith({ type: 'order', order: ['b', 'a', 'c'] });
    orderView.unmount();

    // categorize: an unknown bucket leaves the item in the pool; an unknown item is dropped.
    const categorizeView = render(
      <QuestionView
        question={categorize}
        value={{ type: 'categorize', placements: { i1: 'zz', ghost: 'b1', i2: 'b2' } }}
        onChange={onChange}
      />,
    );
    expect(within(screen.getByRole('group', { name: 'Not placed yet' })).getByText('Fence')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Bucket for Fence' })).toHaveValue('');
    expect(within(screen.getByRole('group', { name: 'Detective' })).getByText('Audit log')).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Preventive' })).queryByRole('listitem')).not.toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Bucket for Audit log' }), 'Preventive');
    expect(onChange).toHaveBeenLastCalledWith({ type: 'categorize', placements: { i2: 'b1' } });
    categorizeView.unmount();

    // match: an unknown right item leaves the row empty; unknown ids are never sent back.
    render(
      <QuestionView
        question={match}
        value={{ type: 'match', pairs: { l1: 'zz', ghost: 'r1', l2: 'r2' } }}
        onChange={onChange}
      />,
    );
    expect(screen.getByRole('combobox', { name: 'Match for Confidentiality' })).toHaveValue('');
    expect(screen.getByRole('combobox', { name: 'Match for Integrity' })).toHaveValue('r2');
    expect(screen.getByText('Encryption', { ignore: 'option' })).not.toHaveTextContent('in use');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Match for Integrity' }), 'Encryption');
    expect(onChange).toHaveBeenLastCalledWith({ type: 'match', pairs: { l2: 'r1' } });
  });

  it('a value of the wrong type renders as unanswered', () => {
    const onChange = vi.fn();
    const singleView = render(
      <QuestionView question={single} value={{ type: 'multi', choices: ['a'] }} onChange={onChange} />,
    );
    for (const radio of screen.getAllByRole('radio')) expect(radio).not.toBeChecked();
    singleView.unmount();

    const multiView = render(<QuestionView question={multi} value={{ type: 'single', choice: 'a' }} onChange={onChange} />);
    for (const box of screen.getAllByRole('checkbox')) expect(box).not.toBeChecked();
    multiView.unmount();

    const orderView = render(
      <QuestionView question={order} value={{ type: 'multi', choices: ['c', 'b', 'a'] }} onChange={onChange} />,
    );
    expect(rowTexts()).toEqual(['Request', 'Approve', 'Implement']);
    orderView.unmount();

    const matchView = render(
      <QuestionView question={match} value={{ type: 'categorize', placements: { l1: 'r1' } }} onChange={onChange} />,
    );
    for (const select of screen.getAllByRole('combobox')) expect(select).toHaveValue('');
    matchView.unmount();

    render(<QuestionView question={categorize} value={{ type: 'match', pairs: { i1: 'b1' } }} onChange={onChange} />);
    expect(within(screen.getByRole('group', { name: 'Not placed yet' })).getAllByRole('listitem')).toHaveLength(2);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('a new question replaces the old one without stale state', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(<QuestionView question={order} value={null} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'Move down: Request' }));
    expect(screen.getByText('Request moved to position 2 of 3.')).toBeInTheDocument();

    const nextOrder: PublicQuestion = {
      ...order, id: 'q-1.1-006', prompt: 'Put the incident steps in order.',
      items: [{ id: 'x', text: 'Detect' }, { id: 'y', text: 'Contain' }],
    };
    rerender(<QuestionView question={nextOrder} value={null} onChange={onChange} />);
    expect(screen.getByRole('list', { name: nextOrder.prompt })).toBeInTheDocument();
    expect(rowTexts()).toEqual(['Detect', 'Contain']);
    expect(screen.queryByText(/Request/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move down: Contain' })).toBeDisabled();

    const matchView = { ...match, id: 'q-1.1-007' };
    rerender(<QuestionView question={matchView} value={{ type: 'match', pairs: { l1: 'r1' } }} onChange={onChange} />);
    expect(screen.queryByRole('list', { name: nextOrder.prompt })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Match for Integrity' }), 'Encryption');
    expect(screen.getByText(/Confidentiality has no match/)).toBeInTheDocument();

    const nextMatch: PublicQuestion = { ...match, id: 'q-1.1-008', prompt: 'Match again.' };
    rerender(<QuestionView question={nextMatch} value={null} onChange={onChange} />);
    expect(screen.queryByText(/has no match/)).not.toBeInTheDocument();
    for (const select of screen.getAllByRole('combobox')) expect(select).toHaveValue('');

    rerender(<QuestionView question={single} value={null} onChange={onChange} />);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: single.prompt })).toBeInTheDocument();
    for (const radio of screen.getAllByRole('radio')) expect(radio).not.toBeChecked();
  });

  it('reduced motion: no result pulse is rendered and order rows move without a transition', () => {
    // The pulse ring is the only decorative element directly inside the question.
    const pulse = (container: HTMLElement) => container.querySelector(':scope > div > span[aria-hidden="true"]');
    const marked = (
      <QuestionView
        question={single}
        value={{ type: 'single', choice: 'a' }}
        onChange={vi.fn()}
        feedback={{ correct: true, fraction: 1, correctAnswer: { type: 'single', choice: 'a' }, explanation: 'Right.' }}
      />
    );
    const list = <QuestionView question={order} value={null} onChange={vi.fn()} />;

    const withMotion = render(marked);
    expect(pulse(withMotion.container)).not.toBeNull();
    withMotion.unmount();
    const listWithMotion = render(list);
    expect(screen.getAllByRole('listitem')[0]!.style.transition).not.toBe('none');
    listWithMotion.unmount();

    // Motion prints a one-off development notice when it first sees the setting; nothing else may be logged.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    motionPreference.set(true);

    const reduced = render(marked);
    expect(pulse(reduced.container)).toBeNull();
    expect(screen.getByRole('status', { name: 'Result' })).toHaveTextContent('Correct');
    reduced.unmount();
    render(list);
    for (const row of screen.getAllByRole('listitem')) expect(row.style.transition).toBe('none');
    for (const [message] of warn.mock.calls) expect(String(message)).toContain('Reduced Motion enabled');
  });

  it('renders text from the API as text, never as HTML', () => {
    const prompt = 'Is <img src=x onerror=alert(1)> a <b>risk</b>?';
    const { container } = render(
      <QuestionView
        question={{ ...single, prompt, options: [{ id: 'a', text: '<i>Yes</i>' }, { id: 'b', text: 'No' }] }}
        value={{ type: 'single', choice: 'a' }}
        onChange={vi.fn()}
        feedback={{
          correct: true, fraction: 1, correctAnswer: { type: 'single', choice: 'a' },
          explanation: '<u>Always</u> encode output.', why: { a: '<s>why</s>', b: 'No.' },
        }}
      />,
    );
    expect(screen.getByText(prompt)).toBeInTheDocument();
    expect(screen.getByText('<i>Yes</i>')).toBeInTheDocument();
    expect(screen.getByText('<u>Always</u> encode output.')).toBeInTheDocument();
    expect(screen.getByText('<s>why</s>')).toBeInTheDocument();
    expect(container.querySelector('img, b, i, u, s')).toBeNull();
  });

  it('isComplete for each type', () => {
    expect(isComplete(single, null)).toBe(false);
    expect(isComplete(single, { type: 'single', choice: 'a' })).toBe(true);

    expect(isComplete(multi, null)).toBe(false);
    expect(isComplete(multi, { type: 'multi', choices: [] })).toBe(false);
    expect(isComplete(multi, { type: 'multi', choices: ['a'] })).toBe(true);

    expect(isComplete(order, null)).toBe(true);
    expect(isComplete(order, { type: 'order', order: ['c', 'b', 'a'] })).toBe(true);

    expect(isComplete(match, null)).toBe(false);
    expect(isComplete(match, { type: 'match', pairs: { l1: 'r1' } })).toBe(false);
    expect(isComplete(match, { type: 'match', pairs: { l1: 'r1', l2: 'r2' } })).toBe(true);

    expect(isComplete(categorize, null)).toBe(false);
    expect(isComplete(categorize, { type: 'categorize', placements: { i1: 'b1' } })).toBe(false);
    expect(isComplete(categorize, { type: 'categorize', placements: { i1: 'b1', i2: 'b1' } })).toBe(true);

    // An answer of the wrong shape never completes a question.
    expect(isComplete(single, { type: 'multi', choices: ['a'] })).toBe(false);
    expect(isComplete(match, { type: 'categorize', placements: { l1: 'r1', l2: 'r2' } })).toBe(false);
  });

  it('isComplete counts only ids that the question has', () => {
    expect(isComplete(single, { type: 'single', choice: 'zz' })).toBe(false);

    expect(isComplete(multi, { type: 'multi', choices: ['zz'] })).toBe(false);
    expect(isComplete(multi, { type: 'multi', choices: ['zz', 'a'] })).toBe(true);

    expect(isComplete(match, { type: 'match', pairs: { l1: 'r1', l2: 'zz' } })).toBe(false);
    expect(isComplete(match, { type: 'match', pairs: { l1: 'r1', ghost: 'r2' } })).toBe(false);
    expect(isComplete(match, { type: 'match', pairs: { l1: 'r1', l2: 'r2', ghost: 'r1' } })).toBe(true);

    expect(isComplete(categorize, { type: 'categorize', placements: { i1: 'b1', i2: 'zz' } })).toBe(false);
    expect(isComplete(categorize, { type: 'categorize', placements: { i1: 'b1', ghost: 'b2' } })).toBe(false);
    expect(isComplete(categorize, { type: 'categorize', placements: { i1: 'b1', i2: 'b2', ghost: 'b1' } })).toBe(true);

    expect(isComplete(order, { type: 'order', order: ['zz'] })).toBe(true);
  });
});
