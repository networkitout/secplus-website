import type { Feedback, LessonProgressView, LessonView } from '../../../shared/types';

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

/** One objective of `GET /api/path`. `mastery` is a whole number from 0 to 100. */
export interface PathObjective {
  id: string;
  title: string;
  published: boolean;
  lessonDone: boolean;
  quizPassed: boolean;
  mastery: number;
}

export interface PathDomain {
  id: number;
  title: string;
  /** Share of the exam, in percent. */
  weight: number;
  unlocked: boolean;
  examPassed: boolean;
  /** False while none of the domain's objectives is published. */
  hasContent: boolean;
  objectives: PathObjective[];
}

/** `GET /api/path` */
export interface PathResponse {
  domains: PathDomain[];
}

/** `GET /api/lessons/:objective` */
export interface LessonResponse {
  lesson: LessonView;
  progress: LessonProgressView;
}

/** What an answer or a finished lesson earned. */
export interface Rewards {
  xp: number;
  newBadges: string[];
}

/** `POST /api/lessons/:objective/progress` */
export type LessonProgressResponse = LessonProgressView & Rewards;

/** `POST /api/answers` */
export type AnswerResponse = { feedback: Feedback } & Rewards;

/** `POST /api/assessments` (201 when created, 200 when an open one is handed back) */
export interface AssessmentStarted {
  id: number;
}
