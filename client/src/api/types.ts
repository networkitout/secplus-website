import type { Answer, Feedback, LessonProgressView, LessonView, PublicQuestion } from '../../../shared/types';

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
  /** The learner's domain exam that is in progress (not submitted, deadline not passed), if any. */
  openExam: OpenAssessment | null;
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

export type AssessmentKind = 'objective' | 'domain' | 'mock';

/** A timed exam that can still be resumed. */
export interface OpenAssessment {
  id: number;
  deadlineAt: string;
}

/** Correct and total question counts, keyed by domain id (`"1"`) or objective id (`"1.2"`). */
export type Tally = Record<string, { correct: number; total: number }>;

/**
 * The outcome of a finalized assessment. `scaledScore` (100 to 900) exists for mock exams only. `xp` is
 * everything the assessment earned: the XP of its answers plus any pass bonus.
 */
export interface AssessmentResult {
  /** 0 to 100, with up to two decimals. */
  scorePct: number;
  scaledScore?: number;
  passed: boolean;
  byDomain: Tally;
  byObjective: Tally;
  xp: number;
  newBadges: string[];
}

/**
 * `GET /api/assessments/:id`. While the assessment is open, `feedback` holds the questions already marked
 * (objective quiz) or nothing (exams). Once it is finalized, `submittedAt` and `result` are set and
 * `feedback` covers every question, answered or not. `deadlineAt` is null for an objective quiz.
 */
export interface AssessmentView {
  id: number;
  kind: AssessmentKind;
  scope: string | null;
  /** A mock exam that does not cover all five domains. */
  partial: boolean;
  questions: PublicQuestion[];
  answers: Record<string, Answer>;
  flags: string[];
  feedback: Record<string, Feedback>;
  deadlineAt: string | null;
  submittedAt: string | null;
  /** The server's clock when it made this view: `deadlineAt` is measured against it, not the device's. */
  serverNow: string;
  result?: AssessmentResult;
}

/**
 * `PUT /api/assessments/:id/answers` with `{ questionId, answer?, flagged? }`. An objective quiz marks the
 * answer (and answers 409 when the question already has one); an exam only stores it. 409 also means the
 * assessment is finalized.
 */
export type AnswerSaveResponse = { feedback: Feedback } | { saved: true };

/** `POST /api/assessments/:id/submit`. Repeating it returns the same result. */
export interface SubmitResponse {
  result: AssessmentResult;
}

/** One finished mock exam in the `mockHistory` of `GET /api/dashboard` (oldest first). */
export interface MockHistoryEntry {
  id: number;
  submittedAt: string;
  scaledScore: number;
  passed: boolean;
  partial: boolean;
}

/** The part of `GET /api/dashboard` that the exam lobby reads. */
export interface DashboardMocks {
  mockHistory: MockHistoryEntry[];
  /** The learner's mock exam that is in progress (not submitted, deadline not passed), if any. */
  openMock: OpenAssessment | null;
  /** What a mock exam started now would be. `questions` is 0 while nothing is published. */
  mockSpec: { questions: number; minutes: number; partial: boolean };
}
