export type Role = 'learner' | 'admin';

/** The user shape returned by `auth/me`, `auth/login` and `auth/accept-invite` (wrapped as `{ user }`). */
export interface User {
  id: number;
  login: string;
  name: string;
  role: Role;
  timeZone: string;
  examDate: string | null;
  hideFromLeaderboard: boolean;
}

/** The fields of `GET /api/dashboard` that the app shell reads. Later screens read the rest. */
export interface DashboardSummary {
  xp: number;
  level: number;
  nextLevelXp: number;
  streak: number;
}

/** `GET /api/auth/invite/:token` */
export interface LinkInfo {
  purpose: 'invite' | 'reset';
  name?: string;
}
