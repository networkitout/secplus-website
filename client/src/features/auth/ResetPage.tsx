import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { api, ApiError } from '../../api/client';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { Field } from '../../ui/Field';
import { AuthLayout } from './AuthLayout';
import { INVALID_LINK, LINK_CHECK_FAILED, MIN_PASSWORD, passwordProblem, useLinkCheck } from './linkCheck';

export function ResetPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const link = useLinkCheck(token, 'reset');
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
      await api.post('auth/reset', { token, password });
      // The server does not sign the user in after a reset.
      void navigate('/login', { replace: true, state: { notice: 'Password updated. Sign in with your new password.' } });
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 410)) setExpired(true);
      else if (err instanceof ApiError) setError(err.message);
      else setError('Could not reset the password. Try again.');
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Reset your password">
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
            {link.info?.name && <p className="text-sm text-muted">Choose a new password for {link.info.name}.</p>}
            <Field label="New password" type="password" autoComplete="new-password" required hint={`At least ${MIN_PASSWORD} characters`} error={passwordError} value={password} onChange={(e) => setPassword(e.target.value)} />
            {error && <p role="alert" className="text-sm text-bad">{error}</p>}
            <Button type="submit" disabled={busy} className="w-full">Update password</Button>
          </form>
        </Card>
      )}
    </AuthLayout>
  );
}
