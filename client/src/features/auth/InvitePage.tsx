import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { api, ApiError } from '../../api/client';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { Field } from '../../ui/Field';
import { usePageTitle } from '../../ui/routeChange';
import { AuthLayout } from './AuthLayout';
import { useAuth } from './AuthProvider';
import { INVALID_LINK, LINK_CHECK_FAILED, MIN_PASSWORD, passwordProblem, useLinkCheck } from './linkCheck';

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
  usePageTitle('Create your account');

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
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 410)) setExpired(true);
      else if (err instanceof ApiError) setError(err.message);
      else setError('Could not create the account. Try again.');
      setBusy(false);
      return;
    }
    // The server has already signed the new user in. If that cannot be read back, the account exists all
    // the same and the link is used up: the way on is the sign-in page, not another try here.
    const me = await refresh().catch(() => null);
    if (me) void navigate('/', { replace: true });
    else void navigate('/login', { replace: true, state: { notice: 'Account created. Sign in to continue.' } });
  }

  return (
    <AuthLayout title="Create your account">
      {link.pending ? (
        <p role="status" className="text-muted">Checking your link…</p>
      ) : link.invalid || expired ? (
        <p role="alert" className="text-bad">{INVALID_LINK}</p>
      ) : link.failed ? (
        <>
          <p role="alert" className="text-bad">{LINK_CHECK_FAILED}</p>
          <Button variant="secondary" onClick={link.retry}>Retry</Button>
        </>
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
    </AuthLayout>
  );
}
