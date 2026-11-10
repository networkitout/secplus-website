import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { api, ApiError, isUnavailable, setUnauthorizedHandler } from '../../api/client';
import type { User } from '../../api/types';

export interface AuthValue {
  user: User | null;
  /** True until the first `auth/me` answer arrives. */
  loading: boolean;
  login(login: string, password: string): Promise<User>;
  /** Rejects, leaving the user signed in, when the server could not end the session. */
  logout(): Promise<void>;
  /** Re-reads the current user from `auth/me` (null when signed out). */
  refresh(): Promise<User | null>;
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
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const refresh = useCallback(async () => {
    try {
      const { user: me } = await api.get<{ user: User }>('auth/me');
      setUser(me);
      return me;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setUser(null);
        return null;
      }
      throw err;
    }
  }, []);

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
      setUser(null);
      void navigate(url, { replace: true });
    });
    return () => setUnauthorizedHandler(null);
  }, [navigate]);

  const login = useCallback(async (loginName: string, password: string) => {
    const { user: me } = await api.post<{ user: User }>('auth/login', { login: loginName, password });
    setUser(me);
    return me;
  }, []);

  const logout = useCallback(async () => {
    // If this fails the server session is still alive, so the user stays signed in and the caller reports it.
    await api.post('auth/logout');
    setUser(null);
    queryClient.clear();
  }, [queryClient]);

  const value = useMemo(() => ({ user, loading, login, logout, refresh }), [user, loading, login, logout, refresh]);
  if (fatal) throw fatal;
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function Loading() {
  return (
    <p role="status" className="p-8 text-center text-muted">
      Loading…
    </p>
  );
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <Loading />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return <>{children}</>;
}

export function RequireAdmin({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  return <RequireAuth>{user?.role === 'admin' ? children : <Navigate to="/" replace />}</RequireAuth>;
}
