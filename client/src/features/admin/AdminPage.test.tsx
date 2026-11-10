import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminUser, User } from '../../api/types';
import { createQueryClient } from '../../queryClient';
import { AuthContext } from '../auth/AuthProvider';
import { AdminPage } from './AdminPage';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

const root: User = { id: 1, login: 'root', name: 'Root', role: 'admin', timeZone: 'UTC', examDate: null, hideFromLeaderboard: false };

const account = (id: number, name: string, over: Partial<AdminUser> = {}): AdminUser => ({
  id, login: name.toLowerCase(), name, role: 'learner', active: true, lastActiveAt: null, domainsPassed: [], latestMockScore: null, ...over,
});

let users: AdminUser[];

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;
let handlers: Record<string, Handler>;
let fetchMock: ReturnType<typeof vi.fn>;
let client: QueryClient;

const keyOf = (url: unknown, init?: RequestInit) => `${init?.method ?? 'GET'} ${String(url)}`;
const calls = (key: string) => fetchMock.mock.calls.filter(([u, i]) => keyOf(u, i) === key);
const bodies = (key: string) => calls(key).map(([, i]) => JSON.parse(String(i.body)));

const USERS = 'GET /api/admin/users';
const INVITES = 'POST /api/admin/invites';
const patch = (id: number) => `PATCH /api/admin/users/${id}`;
const EXPIRES = '2026-11-17T12:00:00.000Z';

function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: { writeText } });
}

beforeEach(() => {
  users = [
    account(1, 'Root', { role: 'admin', lastActiveAt: '2026-11-10T09:15:00.000Z', domainsPassed: [1, 2], latestMockScore: 780 }),
    account(3, 'Bo', { lastActiveAt: '2026-11-09T18:00:00.000Z', domainsPassed: [1], latestMockScore: 640 }),
    account(4, 'Cy', { active: false }),
  ];
  handlers = {
    [USERS]: () => json(200, { users }),
    [INVITES]: (_url, init) =>
      json(200, { url: JSON.parse(String(init?.body)).purpose === 'reset' ? '/reset/tok-reset-xyz' : '/invite/tok-invite-abc', expiresAt: EXPIRES }),
    [patch(3)]: (_url, init) => {
      users = users.map((u) => (u.id === 3 ? { ...u, active: JSON.parse(String(init?.body)).active } : u));
      return json(200, { ok: true });
    },
  };
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const h = handlers[keyOf(url, init)];
    if (!h) throw new Error(`unexpected request ${keyOf(url, init)}`);
    return h(url, init);
  });
  vi.stubGlobal('fetch', fetchMock);
  client = createQueryClient();
  client.setDefaultOptions({ queries: { ...client.getDefaultOptions().queries, retry: false } }); // no 1 s retry wait
});
afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window.navigator, 'clipboard');
});

function renderAdmin() {
  const auth = { user: root, loading: false, login: vi.fn(), logout: vi.fn(), refresh: vi.fn() };
  return render(
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={auth}>
        <MemoryRouter initialEntries={['/admin']}>
          <AdminPage />
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

const button = (name: string) => screen.getByRole('button', { name });
const rowOf = async (name: string) => (await screen.findByRole('rowheader', { name: new RegExp(`^${name}`) })).closest('tr')!;
const cellsOf = (r: HTMLElement) => within(r).getAllByRole('cell').map((c) => c.textContent);

describe('admin', () => {
  it('admin: invite link shows full URL and copies to clipboard; deactivate asks for confirmation', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    renderAdmin();
    expect(screen.getByRole('heading', { level: 1, name: 'Admin' })).toBeInTheDocument();
    await rowOf('Bo');

    await userEvent.click(button('Create invite link'));
    const panel = await screen.findByRole('region', { name: 'Invite link' });
    expect(bodies(INVITES)).toEqual([{ purpose: 'invite' }]);
    const full = `${window.location.origin}/invite/tok-invite-abc`;
    const field = within(panel).getByRole('textbox', { name: 'Invite link' });
    expect(field).toHaveValue(full);
    expect(field).toHaveAttribute('readonly');
    expect(field).toHaveFocus();
    expect(panel.querySelector('time')).toHaveAttribute('datetime', EXPIRES);
    expect(panel).toHaveTextContent(/Expires/);
    expect(panel).toHaveTextContent(/shown only once/i);
    // The link is a secret: it is on the page and nowhere else.
    expect(window.location.href).not.toContain('tok-invite-abc');

    await userEvent.click(within(panel).getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(full);
    expect(await within(panel).findByRole('status')).toHaveTextContent('Copied');

    // Deactivating asks first, and nothing is sent until the admin confirms.
    const opener = button('Deactivate Bo');
    await userEvent.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Deactivate Bo?' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription(/Bo will be signed out and will not be able to sign in/);
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    expect(calls(patch(3))).toHaveLength(0);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
    expect(calls(patch(3))).toHaveLength(0);

    await userEvent.click(opener);
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Deactivate' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await screen.findByText('Bo is deactivated.')).toBeInTheDocument();
    expect(bodies(patch(3))).toEqual([{ active: false }]);
    expect(await screen.findByRole('button', { name: 'Activate Bo' })).toBeInTheDocument();
    expect(cellsOf(await rowOf('Bo'))[4]).toBe('No');
    expect(screen.queryByRole('button', { name: 'Password reset link for Bo' })).not.toBeInTheDocument();
  });

  it('lists every account with last activity, domains passed, latest mock score and state, in a region that scrolls', async () => {
    renderAdmin();
    expect(screen.getByText('Loading the accounts…')).toHaveAttribute('role', 'status');
    const table = await screen.findByRole('table', { name: 'Accounts' });
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Name', 'Login', 'Last active', 'Domains passed', 'Latest mock (estimate)', 'Active', 'Actions',
    ]);
    expect(within(table).getAllByRole('rowheader').map((h) => h.textContent)).toEqual(['Root (admin, you)', 'Bo', 'Cy']);

    const [, lastActive, ...rest] = cellsOf(await rowOf('Root'));
    expect(rest.slice(0, 3)).toEqual(['1, 2', '780', 'Yes']);
    expect(lastActive).toMatch(/2026/);
    expect((await rowOf('Root')).querySelector('time')).toHaveAttribute('datetime', '2026-11-10T09:15:00.000Z');
    expect(cellsOf(await rowOf('Bo')).slice(0, 5)).toEqual(['bo', expect.stringMatching(/2026/), '1', '640', 'Yes']);
    expect(cellsOf(await rowOf('Cy')).slice(0, 5)).toEqual(['cy', 'Never', 'None', 'None', 'No']);

    // Wide tables scroll inside a region that the keyboard can reach.
    const scroller = screen.getByRole('region', { name: 'Accounts table' });
    expect(scroller).toHaveAttribute('tabindex', '0');
    expect(scroller).toContainElement(table);
  });

  it('the admin cannot deactivate their own account here, and a refusal from the server is shown as it is worded', async () => {
    renderAdmin();
    const own = await rowOf('Root');
    expect(within(own).queryByRole('button', { name: /Deactivate|Activate/ })).not.toBeInTheDocument();
    expect(within(own).getByRole('button', { name: 'Password reset link for Root' })).toBeInTheDocument();

    handlers[patch(3)] = () => json(400, { error: 'You cannot change your own active status' });
    await userEvent.click(button('Deactivate Bo'));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Deactivate' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('You cannot change your own active status');
    expect(button('Deactivate Bo')).toBeInTheDocument();
    expect(screen.queryByText('Bo is deactivated.')).not.toBeInTheDocument();
  });

  it('activating also asks first', async () => {
    handlers[patch(4)] = (_url, init) => {
      users = users.map((u) => (u.id === 4 ? { ...u, active: JSON.parse(String(init?.body)).active } : u));
      return json(200, { ok: true });
    };
    renderAdmin();
    await rowOf('Cy');
    await userEvent.click(button('Activate Cy'));
    const dialog = screen.getByRole('dialog', { name: 'Activate Cy?' });
    expect(calls(patch(4))).toHaveLength(0);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Activate' }));
    expect(await screen.findByText('Cy is active again.')).toBeInTheDocument();
    expect(bodies(patch(4))).toEqual([{ active: true }]);
    expect(await screen.findByRole('button', { name: 'Deactivate Cy' })).toBeInTheDocument();
  });

  it('the confirmation is a modal dialog: focus stays inside, Escape cancels, focus returns', async () => {
    renderAdmin();
    await rowOf('Bo');
    const opener = button('Deactivate Bo');
    opener.focus();
    await userEvent.keyboard('{Enter}');
    const dialog = screen.getByRole('dialog', { name: 'Deactivate Bo?' });
    const cancel = within(dialog).getByRole('button', { name: 'Cancel' });
    const confirm = within(dialog).getByRole('button', { name: 'Deactivate' });
    expect(cancel).toHaveFocus();

    await userEvent.tab();
    expect(confirm).toHaveFocus();
    await userEvent.tab();
    expect(cancel).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(confirm).toHaveFocus();

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();

    // After a click on the dialog's text, the keyboard still works.
    await userEvent.click(opener);
    await userEvent.click(screen.getByText(/Bo will be signed out/));
    await userEvent.tab();
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement);
    await userEvent.click(screen.getByText(/Bo will be signed out/));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(calls(patch(3))).toHaveLength(0);
  });

  it('a double press on the confirm button changes the account once', async () => {
    renderAdmin();
    await rowOf('Bo');
    await userEvent.click(button('Deactivate Bo'));
    const confirm = within(screen.getByRole('dialog')).getByRole('button', { name: 'Deactivate' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(await screen.findByText('Bo is deactivated.')).toBeInTheDocument();
    expect(calls(patch(3))).toHaveLength(1);
  });

  it('a password reset link names the learner, posts their id and replaces the link shown before', async () => {
    renderAdmin();
    await rowOf('Bo');
    await userEvent.click(button('Create invite link'));
    await screen.findByRole('region', { name: 'Invite link' });

    await userEvent.click(button('Password reset link for Bo'));
    const panel = await screen.findByRole('region', { name: 'Password reset link for Bo' });
    expect(bodies(INVITES)[1]).toEqual({ purpose: 'reset', userId: 3 });
    const field = within(panel).getByRole('textbox', { name: 'Password reset link for Bo' });
    expect(field).toHaveValue(`${window.location.origin}/reset/tok-reset-xyz`);
    expect(field).toHaveFocus();
    expect(screen.queryByRole('region', { name: 'Invite link' })).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('tok-invite-abc');

    // Put away, it is gone from the page.
    await userEvent.click(within(panel).getByRole('button', { name: 'Hide link' }));
    expect(screen.queryByRole('region', { name: 'Password reset link for Bo' })).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue(/tok-reset-xyz/)).not.toBeInTheDocument();
    expect(document.body).not.toHaveFocus();
  });

  it('shows the message of the server when a link cannot be made', async () => {
    handlers[INVITES] = () => json(404, { error: 'User not found' });
    renderAdmin();
    await rowOf('Bo');
    await userEvent.click(button('Password reset link for Bo'));
    expect(await screen.findByRole('alert')).toHaveTextContent('User not found');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();

    handlers[INVITES] = () => Promise.reject(new TypeError('Failed to fetch'));
    await userEvent.click(button('Create invite link'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("Can't reach the server. No link was made."));
  });

  it('two presses on "Create invite link" make one link', async () => {
    let finish!: (r: Response) => void;
    handlers[INVITES] = () => new Promise<Response>((resolve) => (finish = resolve));
    renderAdmin();
    await rowOf('Bo');
    fireEvent.click(button('Create invite link'));
    fireEvent.click(button('Create invite link'));
    expect(calls(INVITES)).toHaveLength(1);
    await act(async () => finish(json(200, { url: '/invite/tok-invite-abc', expiresAt: EXPIRES })));
    expect(await screen.findByRole('region', { name: 'Invite link' })).toBeInTheDocument();
  });

  it('without a clipboard it says so and selects the link, which stays on the page', async () => {
    renderAdmin();
    await rowOf('Bo');
    await userEvent.click(button('Create invite link'));
    const panel = await screen.findByRole('region', { name: 'Invite link' });
    const field = within(panel).getByRole<HTMLInputElement>('textbox', { name: 'Invite link' });

    await userEvent.click(within(panel).getByRole('button', { name: 'Copy' }));
    expect(await within(panel).findByRole('status')).toHaveTextContent("Couldn't copy the link. It is selected: copy it with your keyboard or the menu.");
    expect(field).toHaveFocus();
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, field.value.length]);
    expect(within(panel).queryByText('Copied')).not.toBeInTheDocument();

    // A browser that has a clipboard but refuses the write is treated the same way.
    stubClipboard(vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError')));
    await userEvent.click(within(panel).getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(within(panel).getByRole('status')).toHaveTextContent(/Couldn't copy the link/));
    expect(field).toHaveValue(`${window.location.origin}/invite/tok-invite-abc`);
  });

  it('a failed refresh keeps the accounts on screen and says so', async () => {
    renderAdmin();
    await rowOf('Bo');
    handlers[USERS] = () => Promise.reject(new TypeError('Failed to fetch'));
    await act(() => client.refetchQueries({ queryKey: ['admin', 'users'] }));
    expect(await screen.findByText("Couldn't refresh the accounts. What you see may be out of date.")).toBeInTheDocument();
    expect(await rowOf('Bo')).toBeInTheDocument();
  });

  it('a server error while loading offers "Try again"', async () => {
    handlers[USERS] = () => json(500, { error: 'Internal error' });
    renderAdmin();
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load the accounts.");
    handlers[USERS] = () => json(200, { users });
    await userEvent.click(button('Try again'));
    expect(await rowOf('Bo')).toBeInTheDocument();
  });
});
