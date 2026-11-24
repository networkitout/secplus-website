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

/**
 * One due card of `GET /api/review/due`. A question card carries its answer-free question; a flashcard
 * carries its term only, and its definition is read with `GET /api/review/flashcard/:cardId`.
 */
export type ReviewCard =
  | { cardId: string; kind: 'question'; question: PublicQuestion }
  | { cardId: string; kind: 'flashcard'; term: string };

/**
 * `GET /api/review/due`. `total` counts every card due today; `cards` holds at most the first 30 of them,
 * oldest first. `nextDueOn` is the first calendar date after today (`YYYY-MM-DD`, in the learner's time
 * zone) on which a card falls due, whether or not any is due today; null when no card is waiting.
 */
export interface ReviewDueResponse {
  total: number;
  cards: ReviewCard[];
  nextDueOn: string | null;
}

/** `GET /api/review/flashcard/:cardId` */
export interface FlashcardDefinition {
  definition: string;
}

/**
 * `POST /api/review/:cardId` with `{ answer }` for a question card or `{ knewIt }` for a flashcard. `box`
 * (1 to 5) is the card's new Leitner box, `previousBox` the one it was in, and `dueOn` the calendar date
 * (`YYYY-MM-DD`, in the learner's time zone) of its next review. A question card adds `feedback`, a
 * flashcard its `definition`. 404 means the card is gone, 409 that it is not due (any more).
 */
export interface ReviewResponse {
  box: number;
  previousBox: number;
  dueOn: string;
  feedback?: Feedback;
  definition?: string;
  xp: number;
  newBadges: string[];
}

/** One lab of `GET /api/labs`. `bestScore` is 0 to 100 with up to two decimals, or null before any attempt. */
export interface LabSummary {
  id: string;
  domain: number;
  title: string;
  /** The objectives whose lessons must be finished (and whose domain must be unlocked) for the lab to open. */
  objectives: string[];
  available: boolean;
  bestScore: number | null;
  passed: boolean;
}

/** `GET /api/labs`, sorted by lab id. */
export interface LabsResponse {
  labs: LabSummary[];
}

/** `GET /api/labs/:id`. 403 while the lab is locked for this learner, 404 when there is no such lab. */
export interface LabView {
  id: string;
  title: string;
  scenario: string;
  steps: PublicQuestion[];
}

/**
 * `POST /api/labs/:id/submit` with `{ answers }` keyed by step id. `steps` holds the feedback of every
 * step, keyed by step id; `scorePct` is 0 to 100 with up to two decimals.
 */
export interface LabSubmitResponse {
  scorePct: number;
  passed: boolean;
  steps: Record<string, Feedback>;
  xp: number;
  newBadges: string[];
}

/** One badge in the `badges` of `GET /api/dashboard`: every badge there is, earned or not. */
export interface DashboardBadge {
  id: string;
  title: string;
  /** How the badge is earned, as a sentence. */
  description: string;
  /** ISO timestamp, or null while the badge is not earned. */
  earnedAt: string | null;
}

/**
 * `GET /api/dashboard` in full. Mastery values are whole numbers from 0 to 100. `weakest` holds at most five
 * objectives the learner has attempted, weakest first. `studyPlan` is null without an exam date; its
 * `daysLeft` is negative once the date has passed.
 */
export interface DashboardResponse extends DashboardSummary, DashboardMocks {
  reviewsDue: number;
  domains: Array<{ id: number; title: string; mastery: number }>;
  weakest: Array<{ objective: string; title: string; mastery: number }>;
  readiness: { ready: boolean; missing: string[] };
  studyPlan: { daysLeft: number; objectivesPerDay: number; message: string } | null;
  badges: DashboardBadge[];
}

/**
 * `GET /api/practice/:objective`: at most ten answer-free questions, those last answered wrong first, then
 * those never answered; empty when every question was last answered right. 404 for an unknown or
 * unpublished objective, 403 while its domain is locked.
 */
export interface PracticeResponse {
  questions: PublicQuestion[];
}

export type LeaderboardPeriod = 'week' | 'all';

/** One row of `GET /api/leaderboard`. `xp` is the XP of the period; `level` always comes from all-time XP. */
export interface LeaderboardRow {
  rank: number;
  userId: number;
  name: string;
  level: number;
  xp: number;
  streak: number;
  isMe: boolean;
}

/**
 * `GET /api/leaderboard?period=week|all`: the best 50 learners with XP in the period. `me` is the viewer's
 * own rank and XP, also beyond the rows; it is null when the viewer is hidden or has no XP in the period.
 */
export interface LeaderboardResponse {
  period: LeaderboardPeriod;
  rows: LeaderboardRow[];
  me: { rank: number; xp: number } | null;
}

/** Body of `PUT /api/settings`: only the fields to change. `examDate` is `YYYY-MM-DD`, or null to clear it. */
export interface SettingsUpdate {
  name?: string;
  timeZone?: string;
  examDate?: string | null;
  hideFromLeaderboard?: boolean;
}

/** `PUT /api/settings` answers with the updated user; 400 `{ error }` names the first invalid field. */
export interface SettingsResponse {
  user: User;
}

/** One account of `GET /api/admin/users` (admins included), oldest account first. */
export interface AdminUser {
  id: number;
  login: string;
  name: string;
  role: Role;
  active: boolean;
  /** ISO timestamp, or null when the account has never been used. */
  lastActiveAt: string | null;
  /** Ids of the domains whose exam is passed, ascending. */
  domainsPassed: number[];
  /** Scaled score (100 to 900) of the latest finished mock exam, or null. */
  latestMockScore: number | null;
}

/** `GET /api/admin/users` */
export interface AdminUsersResponse {
  users: AdminUser[];
}

/**
 * `POST /api/admin/invites` with `{ purpose: 'invite' }` or `{ purpose: 'reset', userId }`. `url` is a path
 * (`/invite/<token>` or `/reset/<token>`) and `expiresAt` an ISO timestamp. The token is not stored in
 * readable form, so the link cannot be shown again. 404 when the reset is for an unknown or inactive user.
 */
export interface AdminLink {
  url: string;
  expiresAt: string;
}
