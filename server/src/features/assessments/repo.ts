import type { Answer, Feedback, PublicQuestion, Question } from '../../../../shared/types.js';
import type { Content } from '../../content/loader.js';
import type { Db } from '../../db/db.js';
import { HttpError } from '../../http.js';
import { PASS, pickMock, pickQuiz, pickSpread, scaledScore, seededRng } from '../../services/assembler.js';
import { AnswerShapeError, correctAnswerOf, feedbackFor, grade, toPublicQuestion } from '../../services/scoring.js';
import { localDate, safeTimeZone } from '../../services/time.js';
import { XP } from '../../services/xp.js';
import { assertObjectiveOpen, unlockedDomains } from '../access.js';
import { DuplicateAttemptError, recordAnswer } from '../answers/repo.js';
import { awardXp, evaluateBadges } from '../xp/repo.js';

export type Kind = 'objective' | 'domain' | 'mock';
type User = { id: number; timeZone: string };
type Tally = Record<string, { correct: number; total: number }>;

export type AssessmentResult = {
  scorePct: number;
  scaledScore?: number;
  passed: boolean;
  byDomain: Tally;
  byObjective: Tally;
  xp: number;
  newBadges: string[];
};

type Row = {
  id: number;
  user_id: number;
  kind: Kind;
  scope: string | null;
  question_ids: unknown;
  answers: unknown;
  flags: unknown;
  started_at: Date;
  deadline_at: Date | null;
  submitted_at: Date | null;
  score_pct: string | number | null;
  scaled_score: number | null;
  passed: number | null;
  breakdown: unknown;
};

type Breakdown = { partial?: boolean; byDomain?: Tally; byObjective?: Tally; xp?: number; newBadges?: string[] };

const QUIZ_SIZE = 10;
const DOMAIN_SIZE = 25;
const DOMAIN_MINUTES = 25;

function json<T>(v: unknown, fallback: T): T {
  const parsed = typeof v === 'string' ? JSON.parse(v) : v;
  return parsed === null || parsed === undefined ? fallback : (parsed as T);
}
const idsOf = (r: Row) => json<string[]>(r.question_ids, []);
const answersOf = (r: Row) => json<Record<string, Answer>>(r.answers, {});
const flagsOf = (r: Row) => json<string[]>(r.flags, []);
const breakdownOf = (r: Row) => json<Breakdown>(r.breakdown, {});
const isExpired = (r: Row, now: Date) => r.submitted_at === null && r.deadline_at !== null && now > new Date(r.deadline_at);

async function lastSeenMap(db: Db, userId: number): Promise<Map<string, number>> {
  const rows = await db.query<{ question_id: string; last: Date }>(
    'SELECT question_id, MAX(created_at) AS last FROM attempts WHERE user_id = ? GROUP BY question_id',
    [userId],
  );
  return new Map(rows.map((r) => [r.question_id, new Date(r.last).getTime()]));
}

/** The learner's own assessment, or 404. */
export async function loadOwned(db: Db, userId: number, id: number, forUpdate = false): Promise<Row> {
  const [row] = await db.query<Row>(`SELECT * FROM assessments WHERE id = ? AND user_id = ?${forUpdate ? ' FOR UPDATE' : ''}`, [id, userId]);
  if (!row) throw new HttpError(404, 'Assessment not found');
  return row;
}

/** Finalizes the assessment when its deadline has passed; returns the (possibly refreshed) row. */
export async function settleIfExpired(db: Db, content: Content, user: User, row: Row, now: Date): Promise<Row> {
  if (!isExpired(row, now)) return row;
  await finalize(db, content, user, row.id, now);
  return loadOwned(db, user.id, row.id);
}

export type OpenAssessment = { id: number; deadlineAt: string };

/**
 * The learner's timed assessments of one kind that can still be resumed, by scope (`null` for a mock).
 * One whose deadline has passed is finalized here, as on any other access, and is not reported.
 *
 * This runs for pages that are not about the exam (the path, the dashboard in every page's header), and two
 * of them can close two exams of one learner at the same moment. If closing one fails (a deadlock, say),
 * that is logged and the exam is left for the next access to close: the page asking must not fail for it.
 */
export async function openAssessments(
  db: Db,
  content: Content,
  user: User,
  kind: 'domain' | 'mock',
  now: Date,
): Promise<Map<string | null, OpenAssessment>> {
  const rows = await db.query<Row>(
    'SELECT * FROM assessments WHERE user_id = ? AND kind = ? AND submitted_at IS NULL AND deadline_at IS NOT NULL ORDER BY id',
    [user.id, kind],
  );
  const open = new Map<string | null, OpenAssessment>();
  for (const row of rows) {
    if (!isExpired(row, now)) {
      if (!open.has(row.scope)) open.set(row.scope, { id: row.id, deadlineAt: new Date(row.deadline_at!).toISOString() });
      continue;
    }
    try {
      await finalize(db, content, user, row.id, now);
    } catch (err) {
      console.error(err);
    }
  }
  return open;
}

/**
 * What a mock exam started now would be: its length, its time limit and whether it leaves domains out.
 * The same numbers `pickMock` arrives at, without drawing the questions: each domain with published
 * content gives its `mockCount`, or all it has when it has fewer, and a mock allows one minute per question.
 */
export function mockSpec(content: Pick<Content, 'manifest' | 'questionsFor'>): { questions: number; minutes: number; partial: boolean } {
  let questions = 0;
  let partial = false;
  for (const domain of content.manifest.domains) {
    const published = domain.objectives.filter((o) => o.published);
    if (published.length === 0) partial = true;
    else questions += Math.min(domain.mockCount, published.reduce((sum, o) => sum + content.questionsFor(o.id).length, 0));
  }
  return { questions, minutes: questions, partial };
}

// ------------------------------------------------------------------ start

export async function startAssessment(
  db: Db,
  content: Content,
  user: User,
  req: { kind: Kind; scope?: string },
  now: Date,
): Promise<{ id: number; created: boolean }> {
  const { kind } = req;
  let scope: string | null = null;
  const rngFor = () => seededRng(`${user.id}:${kind}:${scope ?? ''}:${now.getTime()}`);

  if (kind === 'objective') {
    scope = req.scope!;
    await assertObjectiveOpen(db, content, user.id, scope);
  } else if (kind === 'domain') {
    scope = req.scope!;
    const domain = content.manifest.domains.find((d) => String(d.id) === scope);
    if (!domain) throw new HttpError(404, 'Domain not found');
    if (!(await unlockedDomains(db, content, user.id)).includes(domain.id)) {
      throw new HttpError(403, 'Pass the previous domain exam to unlock this domain');
    }
    if (!domain.objectives.some((o) => o.published)) throw new HttpError(404, 'Domain has no published content');
  } else {
    if (content.publishedObjectives().length === 0) throw new HttpError(404, 'No published content');
  }

  // Expired open assessments are closed (and scored) rather than handed back.
  const open = (q: Db) =>
    q.query<Row>("SELECT * FROM assessments WHERE user_id = ? AND kind = ? AND scope <=> ? AND submitted_at IS NULL ORDER BY id", [user.id, kind, scope]);
  for (const row of await open(db)) await settleIfExpired(db, content, user, row, now);

  return db.tx(async (tx) => {
    // Serialize concurrent starts for one learner so two requests cannot both create an assessment.
    await tx.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [user.id]);
    const [existing] = await open(tx);
    if (existing) return { id: existing.id, created: false };

    const lastSeen = await lastSeenMap(tx, user.id);
    const rng = rngFor();
    let ids: string[];
    let minutes: number | null;
    let breakdown: Breakdown | null = null;
    if (kind === 'objective') {
      ids = pickQuiz(content.questionsFor(scope!), lastSeen, QUIZ_SIZE, rng);
      minutes = null;
    } else if (kind === 'domain') {
      const domain = content.manifest.domains.find((d) => String(d.id) === scope)!;
      const pools = domain.objectives.filter((o) => o.published).map((o) => content.questionsFor(o.id));
      ids = pickSpread(pools, lastSeen, DOMAIN_SIZE, rng);
      minutes = DOMAIN_MINUTES;
    } else {
      const m = pickMock(content, lastSeen, rng);
      ids = m.questionIds;
      minutes = m.minutes;
      breakdown = { partial: m.partial };
    }
    const deadline = minutes === null ? null : new Date(now.getTime() + minutes * 60_000);
    const res = await tx.exec(
      'INSERT INTO assessments (user_id, kind, scope, question_ids, answers, flags, started_at, deadline_at, breakdown) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [user.id, kind, scope, JSON.stringify(ids), '{}', '[]', now, deadline, breakdown ? JSON.stringify(breakdown) : null],
    );
    return { id: res.insertId, created: true };
  });
}

// ------------------------------------------------------------------ view

function missedFeedback(q: Question): Feedback {
  const fb: Feedback = { correct: false, fraction: 0, correctAnswer: correctAnswerOf(q), explanation: q.explanation };
  if (q.type === 'single' || q.type === 'multi') fb.why = q.why;
  return fb;
}

function feedbackOrMissed(q: Question, a: Answer | undefined): Feedback {
  if (!a) return missedFeedback(q);
  try {
    return feedbackFor(q, a);
  } catch (err) {
    if (err instanceof AnswerShapeError) return missedFeedback(q);
    throw err;
  }
}

export type AssessmentView = {
  id: number;
  kind: Kind;
  scope: string | null;
  partial: boolean;
  questions: PublicQuestion[];
  answers: Record<string, Answer>;
  flags: string[];
  feedback: Record<string, Feedback>;
  deadlineAt: string | null;
  submittedAt: string | null;
  /** The server's clock when this view was made: what the client measures `deadlineAt` against. */
  serverNow: string;
  result?: AssessmentResult;
};

function resultOf(row: Row): AssessmentResult {
  const b = breakdownOf(row);
  const result: AssessmentResult = {
    scorePct: Number(row.score_pct ?? 0),
    passed: row.passed === 1 || (row.passed as unknown) === true,
    byDomain: b.byDomain ?? {},
    byObjective: b.byObjective ?? {},
    xp: b.xp ?? 0,
    newBadges: b.newBadges ?? [],
  };
  if (row.kind === 'mock' && row.scaled_score !== null) result.scaledScore = row.scaled_score;
  return result;
}

export function viewOf(content: Content, row: Row, now: Date): AssessmentView {
  const present = idsOf(row).filter((id) => content.questions.has(id));
  const stored = answersOf(row);
  const answers: Record<string, Answer> = {};
  for (const id of present) if (stored[id]) answers[id] = stored[id]!;
  const submitted = row.submitted_at !== null;

  const feedback: Record<string, Feedback> = {};
  if (submitted) {
    for (const id of present) feedback[id] = feedbackOrMissed(content.questions.get(id)!, answers[id]);
  } else if (row.kind === 'objective') {
    for (const id of Object.keys(answers)) feedback[id] = feedbackOrMissed(content.questions.get(id)!, answers[id]);
  }

  return {
    id: row.id,
    kind: row.kind,
    scope: row.scope,
    partial: row.kind === 'mock' && breakdownOf(row).partial === true,
    questions: present.map((id) => toPublicQuestion(content.questions.get(id)!, `${row.id}:${id}`)),
    answers,
    flags: flagsOf(row).filter((id) => present.includes(id)),
    feedback,
    deadlineAt: row.deadline_at ? new Date(row.deadline_at).toISOString() : null,
    submittedAt: row.submitted_at ? new Date(row.submitted_at).toISOString() : null,
    serverNow: now.toISOString(),
    ...(submitted ? { result: resultOf(row) } : {}),
  };
}

// ------------------------------------------------------------------ answers

export async function saveAnswer(
  db: Db,
  content: Content,
  user: User,
  id: number,
  body: { questionId: string; answer?: Answer; flagged?: boolean },
  now: Date,
): Promise<{ feedback: Feedback } | { saved: true }> {
  const { questionId, answer, flagged } = body;
  let row = await loadOwned(db, user.id, id);
  row = await settleIfExpired(db, content, user, row, now);
  if (row.submitted_at) throw new HttpError(409, 'This assessment is already submitted');
  const question = content.questions.get(questionId);
  if (!question || !idsOf(row).includes(questionId)) throw new HttpError(400, 'Question is not part of this assessment');
  if (answer) {
    try {
      grade(question, answer); // rejects a mismatched shape; the result is discarded
    } catch (err) {
      if (err instanceof AnswerShapeError) throw new HttpError(400, err.message);
      throw err;
    }
  }

  const outcome = await db.tx(async (tx) => {
    const locked = await loadOwned(tx, user.id, id, true);
    if (locked.submitted_at) throw new HttpError(409, 'This assessment is already submitted');
    if (isExpired(locked, now)) return 'expired' as const;
    const answers = answersOf(locked);
    let feedback: Feedback | undefined;
    let breakdown = locked.breakdown === null ? null : breakdownOf(locked);

    if (answer && locked.kind === 'objective') {
      if (answers[questionId]) throw new HttpError(409, 'This question was already answered');
      try {
        const rec = await recordAnswer(tx, content, { user, question, answer, context: 'quiz', assessmentId: id, now });
        feedback = rec.feedback;
        // A quiz is marked answer by answer, so what its answers earn is kept with it for the result.
        breakdown = {
          ...breakdown,
          xp: (breakdown?.xp ?? 0) + rec.xp,
          newBadges: [...new Set([...(breakdown?.newBadges ?? []), ...rec.newBadges])],
        };
      } catch (err) {
        if (err instanceof DuplicateAttemptError) throw new HttpError(409, 'This question was already answered');
        throw err;
      }
    }
    if (answer) answers[questionId] = answer;
    const flags = new Set(flagsOf(locked));
    if (flagged === true) flags.add(questionId);
    if (flagged === false) flags.delete(questionId);
    await tx.exec('UPDATE assessments SET answers = ?, flags = ?, breakdown = ? WHERE id = ?', [
      JSON.stringify(answers),
      JSON.stringify([...flags]),
      breakdown === null ? null : JSON.stringify(breakdown),
      id,
    ]);
    return feedback ? { feedback } : { saved: true as const };
  });

  if (outcome === 'expired') {
    await finalize(db, content, user, id, now);
    throw new HttpError(409, 'This assessment is already submitted');
  }
  return outcome;
}

// ------------------------------------------------------------------ finalize

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The single scoring path (submit and the lazy deadline check). Locks the assessment row, is a no-op once
 * submitted, and otherwise grades, records exam attempts, awards XP and stores the result — in one transaction.
 */
export async function finalize(db: Db, content: Content, user: User, id: number, now: Date): Promise<AssessmentResult> {
  const tz = safeTimeZone(user.timeZone);
  return db.tx(async (tx) => {
    const row = await loadOwned(tx, user.id, id, true);
    if (row.submitted_at) return resultOf(row);

    const questions = idsOf(row)
      .map((qid) => content.questions.get(qid))
      .filter((q): q is Question => q !== undefined);
    const answers = answersOf(row);
    let xp = 0;
    const newBadges = new Set<string>();
    const correctIds = new Set<string>();

    if (row.kind === 'objective') {
      const attempts = await tx.query<{ question_id: string; correct: number }>(
        'SELECT question_id, correct FROM attempts WHERE assessment_id = ?',
        [id],
      );
      for (const a of attempts) if (a.correct) correctIds.add(a.question_id);
      // Awarded as each answer was marked (see saveAnswer).
      const soFar = breakdownOf(row);
      xp += soFar.xp ?? 0;
      soFar.newBadges?.forEach((b) => newBadges.add(b));
    } else {
      for (const q of questions) {
        const answer = answers[q.id];
        if (!answer) continue;
        try {
          const rec = await recordAnswer(tx, content, { user, question: q, answer, context: 'exam', assessmentId: id, now });
          xp += rec.xp;
          rec.newBadges.forEach((b) => newBadges.add(b));
          if (rec.feedback.correct) correctIds.add(q.id);
        } catch (err) {
          if (!(err instanceof AnswerShapeError)) throw err; // a stale answer shape counts as wrong
        }
      }
    }

    const byDomain: Tally = {};
    const byObjective: Tally = {};
    let correct = 0;
    for (const q of questions) {
      const ok = correctIds.has(q.id);
      if (ok) correct++;
      for (const [map, key] of [
        [byDomain, String(content.domainOf(q.objective).id)],
        [byObjective, q.objective],
      ] as const) {
        const t = (map[key] ??= { correct: 0, total: 0 });
        t.total++;
        if (ok) t.correct++;
      }
    }
    const fraction = questions.length === 0 ? 0 : correct / questions.length;
    const scorePct = round2(fraction * 100);
    const scaled = row.kind === 'mock' ? scaledScore(fraction) : null;
    const passed =
      questions.length > 0 &&
      (row.kind === 'objective'
        ? scorePct >= PASS.objective
        : row.kind === 'domain'
          ? scorePct >= PASS.domain
          : scaled! >= PASS.mockScaled);

    // `passed` is stored before badges are evaluated so pass badges see it.
    await tx.exec('UPDATE assessments SET submitted_at = ?, score_pct = ?, scaled_score = ?, passed = ? WHERE id = ?', [
      now,
      scorePct,
      scaled,
      passed ? 1 : 0,
      id,
    ]);
    if (passed) {
      // The mock bonus needs a full-length (non-partial) mock and is paid at most once per learner-local day.
      const bonus =
        row.kind === 'objective'
          ? { amount: XP.objectiveQuizPass, reason: 'quiz-pass', ref: row.scope! }
          : row.kind === 'domain'
            ? { amount: XP.domainExamPass, reason: 'domain-pass', ref: row.scope! }
            : breakdownOf(row).partial === true
              ? undefined
              : { amount: XP.mockExamPass, reason: 'mock-pass', ref: localDate(now, tz) };
      if (bonus && (await awardXp(tx, { userId: user.id, ...bonus, now }))) xp += bonus.amount;
    }
    (await evaluateBadges(tx, user.id, tz, now)).forEach((b) => newBadges.add(b));

    const breakdown: Breakdown = { ...breakdownOf(row), byDomain, byObjective, xp, newBadges: [...newBadges] };
    await tx.exec('UPDATE assessments SET breakdown = ? WHERE id = ?', [JSON.stringify(breakdown), id]);

    const result: AssessmentResult = { scorePct, passed, byDomain, byObjective, xp, newBadges: [...newBadges] };
    if (scaled !== null) result.scaledScore = scaled;
    return result;
  });
}
