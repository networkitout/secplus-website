import { Navigate, Outlet, Route, Routes } from 'react-router';
import { InvitePage } from './features/auth/InvitePage';
import { LoginPage } from './features/auth/LoginPage';
import { RequireAdmin, RequireAuth } from './features/auth/AuthProvider';
import { ResetPage } from './features/auth/ResetPage';
import { LessonPage } from './features/lesson/LessonPage';
import { PathPage } from './features/path/PathPage';
import { AppShell } from './ui/AppShell';

// Placeholder until the feature's task replaces it.
function Placeholder({ title }: { title: string }) {
  return <h1 className="text-2xl font-semibold">{title}</h1>;
}

const screens: Array<{ path: string; title: string }> = [
  { path: 'quiz/:id', title: 'Quiz' },
  { path: 'exam', title: 'Exams' },
  { path: 'exam/:id', title: 'Exam' },
  { path: 'review', title: 'Review' },
  { path: 'labs', title: 'Labs' },
  { path: 'labs/:id', title: 'Lab' },
  { path: 'dashboard', title: 'Dashboard' },
  { path: 'leaderboard', title: 'Leaderboard' },
  { path: 'settings', title: 'Settings' },
];

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/invite/:token" element={<InvitePage />} />
      <Route path="/reset/:token" element={<ResetPage />} />
      <Route
        element={
          <RequireAuth>
            <AppShell>
              <Outlet />
            </AppShell>
          </RequireAuth>
        }
      >
        <Route index element={<PathPage />} />
        <Route path="lesson/:objective" element={<LessonPage />} />
        {screens.map((s) => (
          <Route key={s.path} path={s.path} element={<Placeholder title={s.title} />} />
        ))}
        <Route
          path="admin"
          element={
            <RequireAdmin>
              <Placeholder title="Admin" />
            </RequireAdmin>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
