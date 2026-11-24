import type { Content } from '../../content/loader.js';
import type { Db } from '../../db/db.js';
import { domainMastery, objectiveMastery, readiness } from '../../services/mastery.js';
import { studyPlan } from '../../services/studyPlan.js';
import { localDate } from '../../services/time.js';
import { BADGES, xpForLevel } from '../../services/xp.js';
import { unlockedDomains } from '../access.js';
import { mockSpec, openAssessments } from '../assessments/repo.js';
import { dueCount } from '../review/repo.js';
import { totals } from '../xp/repo.js';

type User = { id: number; timeZone: string };

/** question id -> whether the learner's latest attempt was correct (all contexts but labs; questions no longer in content are dropped). */
export async function latestCorrect(db: Db, content: Content, userId: number): Promise<Map<string, boolean>> {
  const rows = await db.query<{ question_id: string; correct: number }>(
    "SELECT question_id, correct FROM attempts WHERE user_id = ? AND context <> 'lab' ORDER BY created_at, id",
    [userId],
  );
  const latest = new Map<string, boolean>();
  for (const r of rows) if (content.questions.has(r.question_id)) latest.set(r.question_id, Boolean(r.correct));
  return latest;
}

async function passedScopes(db: Db, userId: number, kind: 'objective' | 'domain'): Promise<Set<string>> {
  const rows = await db.query<{ scope: string }>(
    'SELECT DISTINCT scope FROM assessments WHERE user_id = ? AND kind = ? AND passed = 1 AND scope IS NOT NULL',
    [userId, kind],
  );
  return new Set(rows.map((r) => r.scope));
}

type ObjectiveStat = { id: string; title: string; published: boolean; mastery: number; questionCount: number; attempted: boolean };

/** Mastery per objective; unpublished objectives are 0 with no weight. */
function objectiveStats(content: Content, latest: Map<string, boolean>): Map<string, ObjectiveStat> {
  const stats = new Map<string, ObjectiveStat>();
  for (const d of content.manifest.domains) {
    for (const o of d.objectives) {
      const ids = o.published ? content.questionsFor(o.id).map((q) => q.id) : [];
      stats.set(o.id, {
        id: o.id,
        title: o.title,
        published: o.published,
        mastery: objectiveMastery(ids, latest),
        questionCount: ids.length,
        attempted: ids.some((id) => latest.has(id)),
      });
    }
  }
  return stats;
}

export async function pathFor(db: Db, content: Content, user: User, now: Date) {
  // First: an exam whose deadline has passed is scored here, and may change what is passed and unlocked.
  const openExams = await openAssessments(db, content, user, 'domain', now);
  const [latest, unlocked, examPassed, quizPassed, lessons] = await Promise.all([
    latestCorrect(db, content, user.id),
    unlockedDomains(db, content, user.id),
    passedScopes(db, user.id, 'domain'),
    passedScopes(db, user.id, 'objective'),
    db.query<{ objective: string }>('SELECT objective FROM lesson_progress WHERE user_id = ? AND completed_at IS NOT NULL', [user.id]),
  ]);
  const lessonDone = new Set(lessons.map((l) => l.objective));
  const stats = objectiveStats(content, latest);
  return {
    domains: content.manifest.domains.map((d) => ({
      id: d.id,
      title: d.title,
      weight: d.weight,
      unlocked: unlocked.includes(d.id),
      examPassed: examPassed.has(String(d.id)),
      hasContent: d.objectives.some((o) => o.published),
      openExam: openExams.get(String(d.id)) ?? null,
      objectives: d.objectives.map((o) => ({
        id: o.id,
        title: o.title,
        published: o.published,
        lessonDone: lessonDone.has(o.id),
        quizPassed: quizPassed.has(o.id),
        mastery: stats.get(o.id)!.mastery,
      })),
    })),
  };
}

const WEAKEST = 5;
const MOCKS_FOR_READINESS = 3;
const DOMAIN_IDS = [1, 2, 3, 4, 5];

export async function dashboardFor(db: Db, content: Content, user: User, now: Date) {
  const today = localDate(now, user.timeZone);
  // First: a mock whose deadline has passed is scored here, and belongs in the history and the totals below.
  const openMock = (await openAssessments(db, content, user, 'mock', now)).get(null) ?? null;
  const [latest, unlocked, quizPassed, tot, reviewsDue, mocks, badgeRows, examRow] = await Promise.all([
    latestCorrect(db, content, user.id),
    unlockedDomains(db, content, user.id),
    passedScopes(db, user.id, 'objective'),
    totals(db, user.id, user.timeZone, now),
    dueCount(db, content, user.id, today),
    db.query<{ id: number; submitted_at: Date; scaled_score: number | null; passed: number | null; breakdown: unknown }>(
      "SELECT id, submitted_at, scaled_score, passed, breakdown FROM assessments WHERE user_id = ? AND kind = 'mock' AND submitted_at IS NOT NULL ORDER BY submitted_at, id",
      [user.id],
    ),
    db.query<{ badge_id: string; earned_at: Date }>('SELECT badge_id, earned_at FROM badges WHERE user_id = ?', [user.id]),
    db.query<{ exam_date: string | null }>('SELECT exam_date FROM users WHERE id = ?', [user.id]),
  ]);

  const stats = objectiveStats(content, latest);
  const domains = content.manifest.domains.map((d) => ({
    id: d.id,
    title: d.title,
    mastery: domainMastery(d.objectives.map((o) => stats.get(o.id)!)),
  }));

  const weakest = content.manifest.domains
    .filter((d) => unlocked.includes(d.id))
    .flatMap((d) => d.objectives.map((o) => stats.get(o.id)!))
    .filter((o) => o.published && o.attempted)
    .sort((a, b) => a.mastery - b.mastery || (a.id < b.id ? -1 : 1))
    .slice(0, WEAKEST)
    .map((o) => ({ objective: o.id, title: o.title, mastery: o.mastery }));

  const mockHistory = mocks.map((m) => {
    const b = typeof m.breakdown === 'string' ? JSON.parse(m.breakdown) : m.breakdown;
    return {
      id: m.id,
      submittedAt: new Date(m.submitted_at).toISOString(),
      scaledScore: m.scaled_score ?? 0,
      passed: Boolean(m.passed),
      partial: (b as { partial?: boolean } | null)?.partial === true,
    };
  });

  const masteryByDomain: Record<number, number> = {};
  for (const id of DOMAIN_IDS) masteryByDomain[id] = domains.find((d) => d.id === id)?.mastery ?? 0;
  const allObjectives = content.manifest.domains.flatMap((d) => d.objectives);

  const earned = new Map(badgeRows.map((b) => [b.badge_id, new Date(b.earned_at).toISOString()]));
  return {
    xp: tot.xp,
    level: tot.level,
    nextLevelXp: xpForLevel(tot.level + 1),
    streak: tot.streak,
    reviewsDue,
    domains,
    weakest,
    mockHistory,
    openMock,
    mockSpec: mockSpec(content),
    readiness: readiness({
      domainMastery: masteryByDomain,
      lastMockScores: mockHistory
        .filter((m) => !m.partial)
        .slice(-MOCKS_FOR_READINESS)
        .map((m) => m.scaledScore),
      allDomainsPublished: allObjectives.every((o) => o.published),
    }),
    studyPlan: studyPlan({
      today,
      examDate: examRow[0]?.exam_date ?? null,
      objectivesRemaining: allObjectives.filter((o) => !quizPassed.has(o.id)).length,
      reviewsDue,
    }),
    badges: BADGES.map((b) => ({ ...b, earnedAt: earned.get(b.id) ?? null })),
  };
}

const PRACTICE_SIZE = 10;

/** Question ids for "practice now": latest attempt wrong first, then never attempted; at most 10. */
export async function practiceIds(db: Db, content: Content, userId: number, objective: string): Promise<string[]> {
  const latest = await latestCorrect(db, content, userId);
  const pool = content.questionsFor(objective).map((q) => q.id);
  const wrong = pool.filter((id) => latest.get(id) === false);
  const unseen = pool.filter((id) => !latest.has(id));
  return [...wrong, ...unseen].slice(0, PRACTICE_SIZE);
}
