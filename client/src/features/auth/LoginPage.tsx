import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useSearchParams } from 'react-router';
import { ApiError } from '../../api/client';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { Field } from '../../ui/Field';
import { useAuth } from './AuthProvider';

/** Only same-site paths are accepted as a post-login target. */
export function safeNext(raw: string | null): string {
  return raw && raw.startsWith('/') && !raw.startsWith('//') && !raw.startsWith('/\\') ? raw : '/';
}

export function LoginPage() {
  const { user, login } = useAuth();
  const [params] = useSearchParams();
  const location = useLocation();
  const notice = (location.state as { notice?: string } | null)?.notice;
  const [loginName, setLoginName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={safeNext(params.get('next'))} replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(loginName, password);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setError('Invalid login or password');
      else if (err instanceof ApiError && err.status === 429) setError('Too many attempts. Wait a few minutes and try again.');
      else if (err instanceof ApiError && (err.status === 0 || err.status === 503)) setError("Can't reach the server. Try again in a moment.");
      else setError('Could not sign in. Try again.');
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-4">
      <h1 className="text-2xl font-semibold">SecPlus Trainer</h1>
      <Card>
        <form onSubmit={onSubmit} className="space-y-4">
          <h2 className="text-lg font-semibold">Sign in</h2>
          {notice && (
            <p role="status" className="text-sm text-ok">
              {notice}
            </p>
          )}
          <Field label="Login name" autoComplete="username" autoCapitalize="none" required value={loginName} onChange={(e) => setLoginName(e.target.value)} />
          <Field label="Password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          {error && (
            <p role="alert" className="text-sm text-bad">
              {error}
            </p>
          )}
          <Button type="submit" disabled={busy} className="w-full">
            Sign in
          </Button>
        </form>
      </Card>
      <p className="text-sm text-muted">No account? Ask the site owner for an invite link.</p>
    </div>
  );
}
