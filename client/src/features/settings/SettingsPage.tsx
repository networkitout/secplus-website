import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { api, ApiError, isUnavailable } from '../../api/client';
import type { SettingsResponse, SettingsUpdate, User } from '../../api/types';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { Field } from '../../ui/Field';
import { saveTheme, type Theme } from '../../ui/theme';
import { useTheme } from '../../ui/ThemeToggle';
import { useAuth } from '../auth/AuthProvider';

/** The account settings as the form holds them. The exam date is `''` when there is none. */
type Form = { name: string; timeZone: string; examDate: string; hideFromLeaderboard: boolean };
/** The fields that the server validates, and so the ones a message can belong to. */
type Checked = 'name' | 'timeZone' | 'examDate';

const formOf = (u: User): Form => ({
  name: u.name,
  timeZone: u.timeZone,
  examDate: u.examDate ?? '',
  hideFromLeaderboard: u.hideFromLeaderboard,
});

/** Only what differs from what the server has. The server trims the name, so spaces around it are no change. */
function changes(stored: Form, form: Form): SettingsUpdate {
  const update: SettingsUpdate = {};
  if (form.name.trim() !== stored.name) update.name = form.name.trim();
  if (form.timeZone !== stored.timeZone) update.timeZone = form.timeZone;
  if (form.examDate !== stored.examDate) update.examDate = form.examDate || null;
  if (form.hideFromLeaderboard !== stored.hideFromLeaderboard) update.hideFromLeaderboard = form.hideFromLeaderboard;
  return update;
}

/**
 * The field a 400 message is about. The server reports the first invalid field in words only: with one
 * field sent it is that one, otherwise the wording tells ("Name …", "Unknown time zone", "Exam date …").
 */
function fieldOf(message: string, sent: SettingsUpdate): Checked | null {
  const checked = (['name', 'timeZone', 'examDate'] as const).filter((f) => sent[f] !== undefined);
  if (checked.length === 1 && sent.hideFromLeaderboard === undefined) return checked[0]!;
  const named = /^name\b/i.test(message) ? 'name' : /time zone/i.test(message) ? 'timeZone' : /^exam date\b/i.test(message) ? 'examDate' : null;
  return named && checked.includes(named) ? named : null;
}

/** UTC, every zone the browser knows, and the stored one even when the browser does not list it. */
function timeZones(stored: string): string[] {
  let listed: string[] = [];
  try {
    listed = Intl.supportedValuesOf('timeZone');
  } catch {
    /* a browser that cannot list them: the stored zone and UTC are still offered */
  }
  return ['UTC', ...[...new Set([...listed, stored])].filter((z) => z !== 'UTC').sort()];
}

const INPUT = 'w-full rounded-md border border-border bg-bg px-3 py-2 text-text';
const THEMES: Array<{ theme: Theme; label: string }> = [
  { theme: 'dark', label: 'Dark' },
  { theme: 'light', label: 'Light' },
];

function ThemeChoice() {
  const theme = useTheme();
  const headingId = useId();
  return (
    <section aria-labelledby={headingId}>
      <Card className="space-y-3">
        <h2 id={headingId} className="text-lg font-semibold">
          Theme
        </h2>
        <div role="radiogroup" aria-labelledby={headingId} className="flex flex-wrap gap-x-6 gap-y-2">
          {THEMES.map((t) => (
            <label key={t.theme} className="flex items-center gap-2">
              <input
                type="radio"
                name="theme"
                checked={theme === t.theme}
                onChange={() => saveTheme(t.theme)}
                className="size-4 accent-accent"
              />
              <span>{t.label}</span>
            </label>
          ))}
        </div>
        <p className="text-xs text-muted">Applies at once and is kept on this device only.</p>
      </Card>
    </section>
  );
}

function AccountForm({ user }: { user: User }) {
  const { refresh } = useAuth();
  const queryClient = useQueryClient();
  // What the server has: the user at first, then the answer to each save.
  const [stored, setStored] = useState(() => formOf(user));
  const [form, setForm] = useState(stored);
  const [errors, setErrors] = useState<Partial<Record<Checked, string>>>({});
  const [formError, setFormError] = useState('');
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);
  // Set and read in the same tick, which state is not: two presses in a row must not send twice.
  const saving = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const status = useRef<HTMLParagraphElement>(null);
  const focusStatus = useRef(false);
  const headingId = useId();
  const zoneId = useId();
  const hideHintId = useId();

  const zones = useMemo(() => timeZones(stored.timeZone), [stored.timeZone]);
  const deviceZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const update = changes(stored, form);
  const dirty = Object.keys(update).length > 0;

  // Save is disabled again once everything is saved. If it was pressed with the keyboard, focus moves to
  // the confirmation instead of staying on a button that no longer works.
  useEffect(() => {
    if (!saved || !focusStatus.current) return;
    focusStatus.current = false;
    status.current?.focus();
  }, [saved]);

  const focusField = (field: Checked) => (formRef.current?.elements.namedItem(field) as HTMLElement | null)?.focus();

  function set<K extends keyof Form>(field: K, value: Form[K]) {
    setForm((f) => ({ ...f, [field]: value }));
    setErrors((e) => ({ ...e, [field]: undefined }));
    setFormError('');
    setSaved('');
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (saving.current || !dirty) return;
    saving.current = true;
    setBusy(true);
    setSaved('');
    setFormError('');
    setErrors({});
    const fromButton = document.activeElement instanceof HTMLButtonElement && formRef.current?.contains(document.activeElement) === true;
    try {
      const { user: fresh } = await api.put<SettingsResponse>('settings', update);
      setStored(formOf(fresh));
      setForm(formOf(fresh));
      // The time zone and the exam date change what the dashboard counts; the name and the visibility
      // change the leaderboard.
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['leaderboard'] });
      let message = 'Settings saved.';
      try {
        await refresh(); // the header and the other pages read the user from there
      } catch {
        message = 'Settings saved. Reload the page to see the change everywhere.';
      }
      focusStatus.current = fromButton;
      setSaved(message);
    } catch (err) {
      const field = err instanceof ApiError && err.status === 400 ? fieldOf(err.message, update) : null;
      if (field && err instanceof ApiError) {
        setErrors({ [field]: err.message });
        focusField(field);
      } else if (err instanceof ApiError && err.status === 400) setFormError(err.message);
      else if (isUnavailable(err)) setFormError("Can't reach the server. Your changes are not saved yet.");
      else setFormError("Couldn't save your settings. Try again.");
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  const zoneDescribedBy = `${zoneId}-hint${errors.timeZone ? ` ${zoneId}-error` : ''}`;

  return (
    <section aria-labelledby={headingId}>
      <Card>
        <form ref={formRef} onSubmit={(e) => void submit(e)} noValidate className="space-y-5">
          <h2 id={headingId} className="text-lg font-semibold">
            Your account
          </h2>
          <Field
            label="Display name"
            name="name"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            maxLength={64}
            autoComplete="nickname"
            hint="Other learners see this name on the leaderboard."
            error={errors.name}
          />
          <div className="space-y-1">
            <label htmlFor={zoneId} className="block text-sm font-medium">
              Time zone
            </label>
            <select
              id={zoneId}
              name="timeZone"
              value={form.timeZone}
              onChange={(e) => set('timeZone', e.target.value)}
              aria-invalid={errors.timeZone ? true : undefined}
              aria-describedby={zoneDescribedBy}
              className={INPUT}
            >
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
            <p id={`${zoneId}-hint`} className="text-xs text-muted">
              {`Your streak, your review days and the days to your exam follow this time zone. Type the first letters to jump in the list. This device is set to ${deviceZone}.`}
            </p>
            {errors.timeZone && (
              <p id={`${zoneId}-error`} className="text-sm text-bad">
                {errors.timeZone}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Field
              label="Exam date"
              name="examDate"
              type="date"
              value={form.examDate}
              onChange={(e) => set('examDate', e.target.value)}
              hint="Optional. With a date, the dashboard shows the days left and a daily plan."
              error={errors.examDate}
            />
            {form.examDate !== '' && (
              <Button
                variant="secondary"
                onClick={() => {
                  set('examDate', '');
                  focusField('examDate'); // this button is about to go
                }}
              >
                Clear exam date
              </Button>
            )}
          </div>
          <div className="space-y-1">
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={form.hideFromLeaderboard}
                onChange={(e) => set('hideFromLeaderboard', e.target.checked)}
                aria-describedby={hideHintId}
                className="mt-0.5 size-4 shrink-0 accent-accent"
              />
              <span className="text-sm font-medium">Hide me from the leaderboard</span>
            </label>
            <p id={hideHintId} className="pl-7 text-xs text-muted">
              You still earn XP and can see the board. Other learners do not see you on it.
            </p>
          </div>
          {formError && (
            <p role="alert" className="text-sm text-bad">
              {formError}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-4">
            <Button type="submit" disabled={!dirty} aria-busy={busy || undefined}>
              {busy ? 'Saving…' : 'Save changes'}
            </Button>
            <p ref={status} role="status" tabIndex={-1} className="rounded-sm text-sm text-ok">
              {saved}
            </p>
          </div>
        </form>
      </Card>
    </section>
  );
}

export function SettingsPage() {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <div className="mx-auto max-w-xl space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <AccountForm user={user} />
      <ThemeChoice />
    </div>
  );
}
