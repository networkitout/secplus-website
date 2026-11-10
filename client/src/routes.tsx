import { Navigate, Outlet, Route, Routes } from 'react-router';
import { AdminPage } from './features/admin/AdminPage';
import { ExamLobbyPage } from './features/assessment/ExamLobbyPage';
import { ExamPage } from './features/assessment/ExamPage';
import { QuizPage } from './features/assessment/QuizPage';
import { InvitePage } from './features/auth/InvitePage';
import { LoginPage } from './features/auth/LoginPage';
import { RequireAdmin, RequireAuth } from './features/auth/AuthProvider';
import { ResetPage } from './features/auth/ResetPage';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { PracticePage } from './features/dashboard/PracticePage';
import { LabPage } from './features/labs/LabPage';
import { LabsPage } from './features/labs/LabsPage';
import { LeaderboardPage } from './features/leaderboard/LeaderboardPage';
import { LessonPage } from './features/lesson/LessonPage';
import { PathPage } from './features/path/PathPage';
import { ReviewPage } from './features/review/ReviewPage';
import { RewardsProvider } from './features/rewards/RewardsProvider';
import { SettingsPage } from './features/settings/SettingsPage';
import { AppShell } from './ui/AppShell';

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/invite/:token" element={<InvitePage />} />
      <Route path="/reset/:token" element={<ResetPage />} />
      <Route
        element={
          <RequireAuth>
            <RewardsProvider>
              <AppShell>
                <Outlet />
              </AppShell>
            </RewardsProvider>
          </RequireAuth>
        }
      >
        <Route index element={<PathPage />} />
        <Route path="lesson/:objective" element={<LessonPage />} />
        <Route path="quiz/:id" element={<QuizPage />} />
        <Route path="exam" element={<ExamLobbyPage />} />
        <Route path="exam/:id" element={<ExamPage />} />
        <Route path="review" element={<ReviewPage />} />
        <Route path="labs" element={<LabsPage />} />
        <Route path="labs/:id" element={<LabPage />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="practice/:objective" element={<PracticePage />} />
        <Route path="leaderboard" element={<LeaderboardPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route
          path="admin"
          element={
            <RequireAdmin>
              <AdminPage />
            </RequireAdmin>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
