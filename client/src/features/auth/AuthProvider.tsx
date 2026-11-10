import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { api, ApiError, isUnavailable, setUnauthorizedHandler } from '../../api/client';
import { saveQueue } from '../../api/saveQueue';
import type { User } from '../../api/types';
import { AuthLayout } from './AuthLayout';

export interface AuthValue {
  user: User | null;
  /** True until the first `auth/me` answer arrives. */
  loading: boolean;
  login(login: string, password: string): Promise<User>;
  /** Rejects, leaving the user signed in, when the server could not end the session. */
  logout(): Promise<void>;
  /** Re-reads the current user from `auth/me` (null when signed out). */
  refresh(): Promise<User | null>;
  /**
   * True from a deliberate sign-out until someone signs in. The sign-in page is then shown without the
   * page that was open: the next person to sign in on this device does not land where the last one was.
   */
  signedOut?: boolean;
}

export const AuthContext = createContext<AuthValue | null>(null);

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [fatal, setFatal] = useState<unknown>(undefined);
  const [signedOut, setSignedOut] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  /**
   * Says who is signed in now. Whenever that is not who it was (someone signs in, the session ends by
   * sign-out, expiry or deactivation, another account takes its place), nothing of the account before may
   * stay behind for the next one: the cached answers of the API go, and so does the notice about a save
   * that was dropped. The first answer after the page has loaded has nothing before it.
   */
  const account = useRef<number | null | undefined>(undefined);
  const signedIn = useCallback(
    (next: User | null) => {
      const id = next?.id ?? null;
      if (account.current !== undefined && id !== account.current) {
        queryClient.clear();
        saveQueue.dismiss();
      }
      account.current = id;
      setUser(next);
      if (next) setSignedOut(false);
    },
    [queryClient],
  );

  const refresh = useCallback(async () => {
    try {
      const { user: me } = await api.get<{ user: User }>('auth/me');
      signedIn(me);
      return me;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        signedIn(null);
        return null;
      }
      throw err;
    }
  }, [signedIn]);

  useEffect(() => {
    let live = true;
    refresh()
      .catch((err) => {
        if (live && isUnavailable(err)) setFatal(err); // surfaces in the error boundary
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [refresh]);

  // A 401 from any API call means the session ended: forget the user and go to the login page.
  useEffect(() => {
    setUnauthorizedHandler((url) => {
      signedIn(null);
      void navigate(url, { replace: true });
    });
    return () => setUnauthorizedHandler(null);
  }, [navigate, signedIn]);

  const login = useCallback(
    async (loginName: string, password: string) => {
      const { user: me } = await api.post<{ user: User }>('auth/login', { login: loginName, password });
      signedIn(me);
      return me;
    },
    [signedIn],
  );

  const logout = useCallback(async () => {
    // If this fails the server session is still alive, so the user stays signed in and the caller reports it.
    await api.post('auth/logout');
    // In the same update as the user: the redirect to the sign-in page reads both.
    setSignedOut(true);
    signedIn(null);
  }, [signedIn]);

  const value = useMemo(
    () => ({ user, loading, login, logout, refresh, signedOut }),
    [user, loading, login, logout, refresh, signedOut],
  );
  if (fatal) throw fatal;
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function Loading() {
  return (
    <AuthLayout>
      <p role="status" className="text-center text-muted">
        Loading…
      </p>
    </AuthLayout>
  );
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading, signedOut } = useAuth();
  const loc = useLocation();
  if (loading) return <Loading />;
  // A session that ended by itself comes back to this page after the sign-in; a deliberate sign-out does not.
  if (!user) return <Navigate to={signedOut ? '/login' : `/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return <>{children}</>;
}

export function RequireAdmin({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  return <RequireAuth>{user?.role === 'admin' ? children : <Navigate to="/" replace />}</RequireAuth>;
}
