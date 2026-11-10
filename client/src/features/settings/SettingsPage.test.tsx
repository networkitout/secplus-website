import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { ApiError } from '../../api/client';
import type { User } from '../../api/types';
import { createQueryClient } from '../../queryClient';
import { ThemeToggle } from '../../ui/ThemeToggle';
import { AuthContext } from '../auth/AuthProvider';
import { SettingsPage } from './SettingsPage';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

const sam: User = { id: 2, login: 'sam', name: 'Sam', role: 'learner', timeZone: 'Europe/London', examDate: null, hideFromLeaderboard: false };

const PUT = 'PUT /api/settings';
type Handler = (init?: RequestInit) => Response | Promise<Response>;
let handler: Handler;
let fetchMock: ReturnType<typeof vi.fn>;
let client: QueryClient;
let refresh: Mock<() => Promise<User | null>>;

const bodies = () => fetchMock.mock.calls.map(([, i]) => JSON.parse(String(i.body)));

/** Answers like the server: the stored user with the sent fields applied. */
const accept = (user: User): Handler => (init) => json(200, { user: { ...user, ...JSON.parse(String(init?.body)) } });

beforeEach(() => {
  handler = accept(sam);
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${url}`;
    if (key !== PUT) throw new Error(`unexpected request ${key}`);
    return handler(init);
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(Intl, 'supportedValuesOf').mockReturnValue(['America/New_York', 'Europe/Berlin', 'Europe/London']);
  client = createQueryClient();
  refresh = vi.fn<() => Promise<User | null>>(async () => sam);
  document.documentElement.setAttribute('data-theme', 'dark');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

function renderSettings(user: User = sam, extra?: ReactNode) {
  const auth = { user, loading: false, login: vi.fn(), logout: vi.fn(), refresh };
  return render(
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={auth}>
        <MemoryRouter>
          {extra}
          <SettingsPage />
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

const name = () => screen.getByLabelText('Display name');
const zone = () => screen.getByLabelText('Time zone');
const examDate = () => screen.getByLabelText('Exam date');
const hide = () => screen.getByRole('checkbox', { name: 'Hide me from the leaderboard' });
const save = () => screen.getByRole('button', { name: 'Save changes' });

describe('settings', () => {
  it('settings: saving sends only changed fields; server 400 message is shown next to the field', async () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    renderSettings();
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    expect(name()).toHaveValue('Sam');
    expect(zone()).toHaveValue('Europe/London');
    expect(examDate()).toHaveValue('');
    expect(hide()).not.toBeChecked();
    // The menu and the text fields are drawn with the same edge, one that stands out from the card.
    for (const field of [name(), zone(), examDate()]) expect(field).toHaveClass('border-field-border');

    await userEvent.type(name(), ' K');
    await userEvent.click(hide());
    await userEvent.click(save());
    expect(await screen.findByText('Settings saved.')).toBeInTheDocument();
    expect(screen.getByText('Settings saved.').closest('[role="status"]')).not.toBeNull();
    expect(bodies()).toEqual([{ name: 'Sam K', hideFromLeaderboard: true }]);
    // The header and the other pages read the new name and settings.
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['dashboard'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['leaderboard'] });
    // What was saved is the new starting point.
    expect(save()).toBeDisabled();
    expect(name()).toHaveValue('Sam K');

    handler = () => json(400, { error: 'Exam date must be a valid date in YYYY-MM-DD format' });
    fireEvent.change(examDate(), { target: { value: '2027-02-10' } });
    await userEvent.selectOptions(zone(), 'Europe/Berlin');
    await userEvent.click(save());
    await waitFor(() => expect(examDate()).toHaveAccessibleDescription(/Exam date must be a valid date in YYYY-MM-DD format/));
    expect(bodies()[1]).toEqual({ timeZone: 'Europe/Berlin', examDate: '2027-02-10' });
    expect(examDate()).toBeInvalid();
    expect(zone()).not.toBeInvalid();
    expect(name()).not.toBeInvalid();
    expect(screen.queryByText('Settings saved.')).not.toBeInTheDocument();
    expect(refresh).toHaveBeenCalledTimes(1);
    // Nothing was lost, and the learner can correct it and save again.
    expect(zone()).toHaveValue('Europe/Berlin');
    expect(save()).toBeEnabled();

    fireEvent.change(examDate(), { target: { value: '2027-02-11' } });
    expect(examDate()).not.toBeInvalid(); // the message goes when the field is changed
  });

  it('puts each server message by its own field, and one it cannot place above the button', async () => {
    renderSettings();
    handler = () => json(400, { error: 'Name is required' });
    await userEvent.clear(name());
    await userEvent.type(name(), '   ');
    await userEvent.click(save());
    await waitFor(() => expect(name()).toHaveAccessibleDescription(/Name is required/));
    expect(name()).toBeInvalid();
    expect(bodies()[0]).toEqual({ name: '' });

    handler = () => json(400, { error: 'Unknown time zone' });
    await userEvent.selectOptions(zone(), 'Europe/Berlin');
    await userEvent.click(save());
    await waitFor(() => expect(zone()).toHaveAccessibleDescription(/Unknown time zone/));
    expect(zone()).toBeInvalid();

    handler = () => json(400, { error: 'Invalid request' });
    await userEvent.click(save());
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid request');
  });

  it('with one changed field, any 400 belongs to that field', async () => {
    renderSettings();
    handler = () => json(400, { error: 'Too long' });
    await userEvent.type(name(), 'x');
    await userEvent.click(save());
    await waitFor(() => expect(name()).toHaveAccessibleDescription(/Too long/));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('Save is disabled until something differs from what is stored', async () => {
    renderSettings();
    expect(save()).toBeDisabled();
    await userEvent.type(name(), 'x');
    expect(save()).toBeEnabled();
    await userEvent.type(name(), '{Backspace}');
    expect(save()).toBeDisabled();
    await userEvent.type(name(), '  '); // the server trims the name: spaces around it are no change
    expect(save()).toBeDisabled();
    await userEvent.click(hide());
    expect(save()).toBeEnabled();
    await userEvent.click(hide());
    expect(save()).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('the exam date can be set and cleared again', async () => {
    const stored = { ...sam, examDate: '2026-12-01' };
    handler = accept(stored);
    renderSettings(stored);
    expect(examDate()).toHaveValue('2026-12-01');
    expect(examDate()).toHaveAttribute('type', 'date');

    await userEvent.click(screen.getByRole('button', { name: 'Clear exam date' }));
    expect(examDate()).toHaveValue('');
    expect(examDate()).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Clear exam date' })).not.toBeInTheDocument();
    await userEvent.click(save());
    expect(await screen.findByText('Settings saved.')).toBeInTheDocument();
    expect(bodies()).toEqual([{ examDate: null }]);

    fireEvent.change(examDate(), { target: { value: '2027-01-15' } });
    await userEvent.click(save());
    await waitFor(() => expect(bodies()).toHaveLength(2));
    expect(bodies()[1]).toEqual({ examDate: '2027-01-15' });
  });

  it("lists the browser's time zones, UTC and the stored zone even when the browser does not list it", () => {
    const first = renderSettings({ ...sam, timeZone: 'UTC' });
    const options = () => within(zone()).getAllByRole('option').map((o) => o.textContent);
    expect(zone().tagName).toBe('SELECT');
    expect(zone()).toHaveValue('UTC');
    expect(options()).toEqual(['UTC', 'America/New_York', 'Europe/Berlin', 'Europe/London']);
    first.unmount();

    renderSettings({ ...sam, timeZone: 'Asia/Calcutta' });
    expect(zone()).toHaveValue('Asia/Calcutta');
    expect(options()).toEqual(['UTC', 'America/New_York', 'Asia/Calcutta', 'Europe/Berlin', 'Europe/London']);
  });

  it('still offers the stored zone when the browser cannot list time zones at all', () => {
    vi.spyOn(Intl, 'supportedValuesOf').mockImplementation(() => {
      throw new RangeError('Invalid key : timeZone');
    });
    renderSettings();
    expect(zone()).toHaveValue('Europe/London');
    expect(within(zone()).getAllByRole('option').map((o) => o.textContent)).toEqual(['UTC', 'Europe/London']);
  });

  it('a press on Save while a save is on its way sends nothing more', async () => {
    let finish!: (r: Response) => void;
    handler = () => new Promise<Response>((resolve) => (finish = resolve));
    renderSettings();
    await userEvent.click(hide());
    fireEvent.click(save());
    fireEvent.click(screen.getByRole('button', { name: /Sav/ }));
    fireEvent.submit(name().closest('form')!);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Saving…' })).toHaveAttribute('aria-busy', 'true');

    finish(json(200, { user: { ...sam, hideFromLeaderboard: true } }));
    expect(await screen.findByText('Settings saved.')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('what is typed while a save is on its way is kept, and is sent by the next save', async () => {
    let finish!: (r: Response) => void;
    handler = () => new Promise<Response>((resolve) => (finish = resolve));
    renderSettings();
    await userEvent.type(name(), '  K'); // sent trimmed; the server answers with "Sam K"
    await userEvent.click(save());
    expect(bodies()).toEqual([{ name: 'Sam  K' }]);

    // The fields stay open during the request.
    expect(name()).toBeEnabled();
    await userEvent.type(name(), 'ay');
    await userEvent.click(hide());
    fireEvent.change(examDate(), { target: { value: '2027-03-01' } });
    await userEvent.click(name());

    finish(json(200, { user: { ...sam, name: 'Sam K' } }));
    expect(await screen.findByText('Settings saved.')).toBeInTheDocument();
    expect(name()).toHaveValue('Sam  Kay');
    expect(hide()).toBeChecked();
    expect(examDate()).toHaveValue('2027-03-01');
    expect(zone()).toHaveValue('Europe/London');
    // Focus stays where the learner is typing, and what is not saved yet can be saved.
    expect(name()).toHaveFocus();
    expect(save()).toBeEnabled();

    handler = accept({ ...sam, name: 'Sam K' });
    await userEvent.click(save());
    await waitFor(() => expect(bodies()).toHaveLength(2));
    expect(bodies()[1]).toEqual({ name: 'Sam  Kay', examDate: '2027-03-01', hideFromLeaderboard: true });
  });

  it('a field that was not touched during the save takes the value the server stored', async () => {
    handler = () => json(200, { user: { ...sam, name: 'Sam K' } });
    renderSettings();
    await userEvent.type(name(), ' K  ');
    await userEvent.click(save());
    expect(await screen.findByText('Settings saved.')).toBeInTheDocument();
    expect(name()).toHaveValue('Sam K'); // as the server trimmed it
    expect(save()).toBeDisabled();
  });

  it('when the server cannot be reached the form keeps what was typed and says it is not saved', async () => {
    handler = () => Promise.reject(new TypeError('Failed to fetch'));
    renderSettings();
    await userEvent.type(name(), 'my');
    await userEvent.click(save());
    expect(await screen.findByRole('alert')).toHaveTextContent("Can't reach the server. Your changes are not saved yet.");
    expect(name()).toHaveValue('Sammy');
    expect(save()).toBeEnabled();
    expect(refresh).not.toHaveBeenCalled();

    handler = accept(sam);
    await userEvent.click(save());
    expect(await screen.findByText('Settings saved.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says so when the save worked but the rest of the page could not be refreshed', async () => {
    refresh.mockRejectedValue(new ApiError(0, "Can't reach the server"));
    renderSettings();
    await userEvent.click(hide());
    await userEvent.click(save());
    expect(await screen.findByText('Settings saved. Reload the page to see the change everywhere.')).toBeInTheDocument();
    expect(save()).toBeDisabled();
  });

  it('keeps keyboard focus on the page when Save is pressed and then disabled', async () => {
    renderSettings();
    await userEvent.click(hide());
    save().focus();
    await userEvent.keyboard('{Enter}');
    const saved = await screen.findByText('Settings saved.');
    expect(saved.closest('[role="status"]')).toHaveFocus();
  });

  it('the theme choice applies at once, is kept on this device, and the header button follows it', async () => {
    renderSettings(sam, <ThemeToggle />);
    const theme = screen.getByRole('radiogroup', { name: 'Theme' });
    expect(within(theme).getByRole('radio', { name: 'Dark' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBeInTheDocument();

    await userEvent.click(within(theme).getByRole('radio', { name: 'Light' }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(localStorage.getItem('theme')).toBe('light');
    expect(within(theme).getByRole('radio', { name: 'Light' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Switch to dark theme' })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled(); // the theme is not an account setting

    // And the other way round: the header button moves the choice shown here.
    await userEvent.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
    expect(within(theme).getByRole('radio', { name: 'Dark' })).toBeChecked();
    expect(save()).toBeDisabled();
  });
});
