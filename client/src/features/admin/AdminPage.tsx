import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import { api, ApiError, isUnavailable } from '../../api/client';
import type { AdminLink, AdminUser, AdminUsersResponse } from '../../api/types';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { formatInstant } from '../../lib/dates';
import { QueryStatus } from '../../ui/QueryStatus';
import { useAuth } from '../auth/AuthProvider';

/** An invite or reset link that was just made. It lives in this state only: the server cannot show it again. */
type ShownLink = { title: string; reset: boolean; url: string; expiresAt: string };

const CELL = 'px-3 py-2 align-top';
/** For text that holds a display name: a name of 64 characters without a space breaks where the line ends. */
const NAMED = '[overflow-wrap:anywhere]';
const HEAD = 'px-3 py-2 font-medium';

/** The server's own words for a request it refused; a general message for anything else. */
function refusal(err: unknown, unreachable: string, other: string): string {
  if (isUnavailable(err)) return unreachable;
  return err instanceof ApiError && err.status >= 400 && err.status < 500 ? err.message : other;
}

function LinkPanel({ link, timeZone, onHide }: { link: ShownLink; timeZone: string; onHide(): void }) {
  const field = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState('');
  const headingId = useId();

  // The link is what the admin asked for: focus goes to it, and it is selected. Not while a dialog is
  // open, though: a link can arrive during one, and focus belongs to the dialog then.
  useEffect(() => {
    if (!document.querySelector('[role="dialog"]')) field.current?.focus();
  }, []);

  async function copy() {
    try {
      // Only in a secure context (HTTPS or localhost), and the browser may still refuse.
      if (!navigator.clipboard) throw new Error('No clipboard');
      await navigator.clipboard.writeText(link.url);
      setNote('Copied');
    } catch {
      field.current?.focus();
      field.current?.select();
      setNote("Couldn't copy the link. It is selected: copy it with your keyboard or the menu.");
    }
  }

  return (
    <section aria-labelledby={headingId}>
      <Card className="space-y-3 border-accent">
        <h2 id={headingId} className={`${NAMED} text-lg font-semibold`}>
          {link.title}
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={field}
            readOnly
            value={link.url}
            aria-labelledby={headingId}
            onFocus={(e) => e.currentTarget.select()}
            className="min-w-0 flex-1 basis-64 rounded-md border border-border bg-bg px-3 py-2 font-mono text-sm text-text"
          />
          <Button onClick={() => void copy()}>Copy</Button>
        </div>
        <p role="status" className="text-sm">
          {note}
        </p>
        <p className="text-sm text-muted">
          {'Expires '}
          <time dateTime={link.expiresAt}>{formatInstant(link.expiresAt, timeZone, { time: true })}</time>
          {`, and works once. It is shown only once: copy it now and pass it on privately. Anyone who has it can ${
            link.reset ? "set this account's password" : 'create an account'
          }.`}
        </p>
        <Button variant="secondary" onClick={onHide}>
          Hide link
        </Button>
      </Card>
    </section>
  );
}

export function AdminPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const accounts = useQuery({ queryKey: ['admin', 'users'], queryFn: () => api.get<AdminUsersResponse>('admin/users') });
  const [link, setLink] = useState<ShownLink | null>(null);
  const [confirming, setConfirming] = useState<AdminUser | null>(null);
  // Each kind of request has its own pending state, message and error: neither waits for, hides or drops
  // the other. The refs are set and read in the same tick, which state is not: two presses in a row must
  // not send twice.
  // The link that is being made: for an account (a reset link) or for nobody yet (an invite).
  const [makingLink, setMakingLink] = useState<{ target?: AdminUser } | null>(null);
  const linkBusy = useRef(false);
  const [linkError, setLinkError] = useState('');
  // The accounts whose change is on its way.
  const [updating, setUpdating] = useState<AdminUser[]>([]);
  const updatingIds = useRef(new Set<number>());
  const [accountNote, setAccountNote] = useState('');
  const [accountError, setAccountError] = useState('');
  const linkOpener = useRef<HTMLElement | null>(null);
  const inviteId = useId();
  const inviteHeadingId = useId();
  const accountsHeadingId = useId();
  const timeZone = user?.timeZone ?? 'UTC';

  /** One link at a time: the page shows one link, and a second one would be made without ever being seen. */
  async function makeLink(target?: AdminUser) {
    if (linkBusy.current) return;
    linkBusy.current = true;
    setMakingLink({ target });
    linkOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setLinkError('');
    try {
      const made = await api.post<AdminLink>('admin/invites', target ? { purpose: 'reset', userId: target.id } : { purpose: 'invite' });
      setLink({
        title: target ? `Password reset link for ${target.name}` : 'Invite link',
        reset: target !== undefined,
        url: window.location.origin + made.url,
        expiresAt: made.expiresAt,
      });
    } catch (err) {
      setLinkError(refusal(err, "Can't reach the server. No link was made.", "Couldn't make the link. Try again."));
    } finally {
      linkBusy.current = false;
      setMakingLink(null);
    }
  }

  function hideLink() {
    // The panel is about to go: focus returns to the button that made the link.
    const opener = linkOpener.current?.isConnected ? linkOpener.current : document.getElementById(inviteId);
    opener?.focus();
    setLink(null);
  }

  /** The dialog for an account opens only while no change of that account is on its way. */
  function ask(target: AdminUser) {
    if (!updatingIds.current.has(target.id)) setConfirming(target);
  }

  async function setActive(target: AdminUser, active: boolean) {
    setConfirming(null);
    // A second press on the confirm button, before the dialog has gone: the change is already on its way.
    if (updatingIds.current.has(target.id)) return;
    updatingIds.current.add(target.id);
    setUpdating((list) => [...list, target]);
    setAccountError('');
    setAccountNote('');
    try {
      await api.patch<{ ok: true }>(`admin/users/${target.id}`, { active });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      void queryClient.invalidateQueries({ queryKey: ['leaderboard'] }); // a deactivated learner leaves it
      setAccountNote(active ? `${target.name} is active again.` : `${target.name} is deactivated.`);
    } catch (err) {
      setAccountError(refusal(err, "Can't reach the server. Nothing was changed.", "Couldn't change the account. Try again."));
    } finally {
      updatingIds.current.delete(target.id);
      setUpdating((list) => list.filter((u) => u.id !== target.id));
    }
  }

  const makingInvite = makingLink !== null && makingLink.target === undefined;
  const linkNote = makingLink ? (makingLink.target ? `Making the password reset link for ${makingLink.target.name}…` : 'Making the invite link…') : '';
  const accountStatus = [...updating.map((u) => `Updating ${u.name}…`), accountNote].filter(Boolean).join(' ');

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <h1 className="text-2xl font-semibold">Admin</h1>

      <section aria-labelledby={inviteHeadingId}>
        <Card className="space-y-3">
          <h2 id={inviteHeadingId} className="text-lg font-semibold">
            Invite a learner
          </h2>
          <p className="text-muted">An invite link lets one person create an account. No email is sent: you pass the link on yourself.</p>
          {/* Not disabled while the link is made: a disabled button would drop keyboard focus. */}
          <Button id={inviteId} aria-busy={makingInvite || undefined} onClick={() => void makeLink()}>
            {makingInvite ? 'Creating link…' : 'Create invite link'}
          </Button>
        </Card>
      </section>

      <p role="status" className={`${NAMED} text-sm`}>
        {linkNote}
      </p>
      {linkError && (
        <p role="alert" className="text-bad">
          {linkError}
        </p>
      )}

      {link && <LinkPanel key={link.url} link={link} timeZone={timeZone} onHide={hideLink} />}

      <section aria-labelledby={accountsHeadingId} className="space-y-3">
        <h2 id={accountsHeadingId} className="text-lg font-semibold">
          Learners
        </h2>
        <p role="status" className={`${NAMED} text-sm`}>
          {accountStatus}
        </p>
        {accountError && (
          <p role="alert" className="text-bad">
            {accountError}
          </p>
        )}
        <QueryStatus query={accounts} what="the accounts" />
        {accounts.data && (
          // `relative`: the visually hidden parts of the button names are positioned inside the scrolling
          // region. Without it they would widen the page itself.
          <div role="region" aria-label="Accounts table" tabIndex={0} className="relative overflow-x-auto rounded-lg border border-border bg-surface">
            <table className="w-full min-w-[52rem] text-left text-sm">
              <caption className="sr-only">Accounts</caption>
              <thead>
                <tr className="border-b border-border text-muted">
                  <th scope="col" className={HEAD}>Name</th>
                  <th scope="col" className={HEAD}>Login</th>
                  <th scope="col" className={HEAD}>Last active</th>
                  <th scope="col" className={HEAD}>Domains passed</th>
                  <th scope="col" className={HEAD}>Latest mock (estimate)</th>
                  <th scope="col" className={HEAD}>Active</th>
                  <th scope="col" className={HEAD}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {accounts.data.users.map((u) => {
                  const own = u.id === user?.id;
                  const tags = [u.role === 'admin' ? 'admin' : '', own ? 'you' : ''].filter(Boolean);
                  const changing = updating.some((x) => x.id === u.id);
                  const makingReset = makingLink?.target?.id === u.id;
                  return (
                    <tr key={u.id} className="border-b border-border last:border-b-0">
                      <th scope="row" className={`${CELL} ${NAMED} max-w-64 min-w-32 font-semibold`}>
                        {u.name}
                        {tags.length > 0 && <span className="font-normal text-muted">{` (${tags.join(', ')})`}</span>}
                      </th>
                      <td className={`${CELL} font-mono`}>{u.login}</td>
                      <td className={CELL}>
                        {u.lastActiveAt ? <time dateTime={u.lastActiveAt}>{formatInstant(u.lastActiveAt, timeZone, { time: true })}</time> : 'Never'}
                      </td>
                      <td className={CELL}>{u.domainsPassed.length > 0 ? u.domainsPassed.join(', ') : 'None'}</td>
                      <td className={`${CELL} font-mono`}>{u.latestMockScore ?? 'None'}</td>
                      <td className={CELL}>{u.active ? 'Yes' : 'No'}</td>
                      <td className={CELL}>
                        <div className="flex flex-wrap items-center gap-2">
                          {/* The server makes reset links for active accounts only. */}
                          {u.active && (
                            <Button variant="secondary" aria-busy={makingReset || undefined} onClick={() => void makeLink(u)}>
                              {makingReset ? 'Creating link… ' : 'Password reset link '}
                              <span className="sr-only">{`for ${u.name}`}</span>
                            </Button>
                          )}
                          {own ? (
                            <span className="text-muted">You can't deactivate your own account.</span>
                          ) : (
                            <Button variant="secondary" aria-busy={changing || undefined} onClick={() => ask(u)}>
                              {changing ? (u.active ? 'Deactivating… ' : 'Activating… ') : u.active ? 'Deactivate ' : 'Activate '}
                              <span className="sr-only">{u.name}</span>
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {confirming && (
        // `overflow-wrap` is inherited: the dialog's title and text break a long name as well.
        <div className={NAMED}>
          {confirming.active ? (
            <ConfirmDialog
              title={`Deactivate ${confirming.name}?`}
              confirmLabel="Deactivate"
              onConfirm={() => void setActive(confirming, false)}
              onCancel={() => setConfirming(null)}
            >
              <p>{`${confirming.name} will be signed out and will not be able to sign in until you activate the account again.`}</p>
              <p className="text-sm text-muted">Their progress is kept. They leave the leaderboard while the account is not active.</p>
            </ConfirmDialog>
          ) : (
            <ConfirmDialog
              title={`Activate ${confirming.name}?`}
              confirmLabel="Activate"
              onConfirm={() => void setActive(confirming, true)}
              onCancel={() => setConfirming(null)}
            >
              <p>{`${confirming.name} will be able to sign in again.`}</p>
            </ConfirmDialog>
          )}
        </div>
      )}
    </div>
  );
}
