import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { api, ApiError } from '../../api/client';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { Field } from '../../ui/Field';
import { useAuth } from './AuthProvider';
import { INVALID_LINK, MIN_PASSWORD, passwordProblem, useLinkCheck } from './linkCheck';

export function InvitePage() {
  const { token } = useParams();
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const link = useLinkCheck(token, 'invite');
  const [loginName, setLoginName] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [expired, setExpired] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const problem = passwordProblem(password);
    setPasswordError(problem);
    if (problem) return;
    setBusy(true);
    setError('');
    try {
      await api.post('auth/accept-invite', {
        token,
        login: loginName,
        name,
        password,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      await refresh(); // the server has already signed the new user in
      void navigate('/', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 410)) setExpired(true);
      else if (err instanceof ApiError) setError(err.message);
      else setError('Could not create the account. Try again.');
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-4">
      <h1 className="text-2xl font-semibold">Create your account</h1>
      {link.pending ? (
        <p role="status" className="text-muted">Checking your link…</p>
      ) : link.invalid || expired ? (
        <p role="alert" className="text-bad">{INVALID_LINK}</p>
      ) : (
        <Card>
          <form onSubmit={onSubmit} noValidate className="space-y-4">
            <Field label="Login name" autoComplete="username" autoCapitalize="none" required hint="3-64 characters: a-z, 0-9, dot, underscore or hyphen" value={loginName} onChange={(e) => setLoginName(e.target.value)} />
            <Field label="Display name" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} />
            <Field label="Password" type="password" autoComplete="new-password" required hint={`At least ${MIN_PASSWORD} characters`} error={passwordError} value={password} onChange={(e) => setPassword(e.target.value)} />
            {error && <p role="alert" className="text-sm text-bad">{error}</p>}
            <Button type="submit" disabled={busy} className="w-full">Create account</Button>
          </form>
        </Card>
      )}
    </div>
  );
}
