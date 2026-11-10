import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { holdPressClock } from '../test/pressClock';
import { SETTLE_MS, setPressClock, usePressGuard } from './pressGuard';

/** One button that is "Check" first and "Next" once it has been pressed, in the same place. */
function Swap({ onPress }: { onPress(action: string): void }) {
  const [action, setAction] = useState('Check');
  const [renders, setRenders] = useState(0);
  const guard = usePressGuard(action);
  return (
    <>
      <button
        onClick={() => {
          if (!guard.settled()) return;
          onPress(action);
          setAction(action === 'Check' ? 'Next' : 'Check');
        }}
      >
        {action}
      </button>
      <button onClick={() => setRenders(renders + 1)}>{`Rendered ${renders} times`}</button>
      <button onClick={() => guard.restart()}>Restart</button>
    </>
  );
}

const main = () => screen.getByRole('button', { name: /Check|Next/ });

describe('usePressGuard', () => {
  afterEach(() => vi.restoreAllMocks());

  it('ignores a press until the settle window after the action appeared is over', async () => {
    const clock = holdPressClock();
    const onPress = vi.fn();
    render(<Swap onPress={onPress} />);

    await userEvent.click(main());
    clock.advance(SETTLE_MS - 1);
    await userEvent.click(main());
    expect(onPress).not.toHaveBeenCalled();
    // Ignored, and nothing else: the button is as it was.
    expect(main()).toHaveTextContent('Check');
    expect(main()).toBeEnabled();

    clock.advance(1);
    await userEvent.click(main());
    expect(onPress.mock.calls).toEqual([['Check']]);
  });

  it('starts the window again when the action changes, for mouse and keyboard alike, and not on other renders', async () => {
    const clock = holdPressClock();
    const onPress = vi.fn();
    render(<Swap onPress={onPress} />);
    clock.advance(SETTLE_MS);

    // The second click of a double click lands on the button after it has become "Next".
    await userEvent.dblClick(main());
    expect(onPress.mock.calls).toEqual([['Check']]);
    expect(main()).toHaveTextContent('Next');
    // A key that is held repeats its press for as long as the window lasts.
    main().focus();
    await userEvent.keyboard('{Enter}{Enter}{Enter}');
    await userEvent.keyboard(' ');
    expect(onPress).toHaveBeenCalledTimes(1);

    clock.advance(SETTLE_MS);
    await userEvent.click(screen.getByRole('button', { name: 'Rendered 0 times' }));
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: 'Rendered 2 times' })).toBeInTheDocument();
    await userEvent.click(main());
    expect(onPress.mock.calls).toEqual([['Check'], ['Next']]);
  });

  it('restart() starts the window at once, before anything has changed on screen', async () => {
    const clock = holdPressClock();
    const onPress = vi.fn();
    render(<Swap onPress={onPress} />);
    clock.advance(SETTLE_MS);

    await userEvent.click(screen.getByRole('button', { name: 'Restart' }));
    await userEvent.click(main());
    expect(onPress).not.toHaveBeenCalled();
    clock.advance(SETTLE_MS);
    await userEvent.click(main());
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('measures on the monotonic clock of the page, not on the time of day', async () => {
    setPressClock(null);
    let elapsed = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => elapsed);
    const onPress = vi.fn();
    render(<Swap onPress={onPress} />);

    // The device's clock is set forward by an hour: that is not time the learner has had.
    const hourAhead = Date.now() + 3_600_000;
    vi.spyOn(Date, 'now').mockImplementation(() => hourAhead);
    elapsed = SETTLE_MS - 1;
    await userEvent.click(main());
    expect(onPress).not.toHaveBeenCalled();
    elapsed = SETTLE_MS;
    await userEvent.click(main());
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
