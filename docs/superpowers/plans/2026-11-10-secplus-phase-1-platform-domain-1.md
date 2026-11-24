# Security+ Training Site — Phase 1 (Platform + Domain 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete training platform (accounts, lessons, quizzes, review, labs, exams, dashboard, leaderboard) with Domain 1 content, deployable to Hostinger.

**Architecture:** One Node.js app. An Express + TypeScript server exposes a JSON API under `/api`, serves the built React client, and loads lesson/question content from files in `content/` at start. MySQL holds users and progress only. Grading, XP and scheduling live in pure services that are tested without a database.

**Tech Stack:** Node 20+, TypeScript, Express 5, `mysql2`, Zod, `bcryptjs`, Helmet, `express-rate-limit`, `marked`, `gray-matter`; React 19, Vite, Tailwind CSS 4, Motion, React Router 7, TanStack Query 5, dnd-kit; Vitest, Supertest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-10-secplus-training-site-design.md`

## Global Constraints

- Node.js `>=20` (`engines` in `package.json`). MySQL 8.
- Single `package.json` at the repo root. `npm run build` then `npm start` must be all Hostinger needs.
- All work happens on branch `phase-1`. **Do not push or merge to `main`**: Hostinger deploys from the GitHub repo. Merging is Task 26 and needs the owner's go-ahead.
- The repo is public. Never commit secrets. `.env` is git-ignored; `.env.example` lists variable names only.
- All content is original. Never reproduce real exam questions or third-party text.
- All grading happens on the server. No response may contain `correct`, `explanation` or `why` for a question the learner has not yet answered.
- Parameterized SQL only. Every route validates its input with Zod and returns `400 {error}` on failure.
- Content ids (`q-1.1-001`, `f-1.1-001`, `lab-1-01`) are never reused or renamed once committed.
- Passwords: minimum 12 characters, bcrypt cost 12.
- Pass marks: objective quiz 10 questions, 80%. Domain exam 25 questions, 75%. Mock exam scaled score `round(100 + 800 × fraction)`, pass at 750.
- Leitner intervals in days by box 1–5: `1, 2, 4, 8, 16`.
- Mock exam counts for domains 1–5: `11, 20, 16, 25, 18`; one minute per question.
- Honor `prefers-reduced-motion`. WCAG 2.2 AA: every interaction works by keyboard; visible focus.
- Footer on every page: "Not affiliated with or endorsed by CompTIA. Security+ is a trademark of CompTIA, Inc."
- Every server function that depends on the current time takes it from the injected `now()` (see Task 5), never `new Date()` directly.

## Review Focus

Conditions the spec implies but does not spell out. Each has a pinning test in the task named.

1. **Same answer submitted twice** (double click, two tabs): one attempt row, XP awarded once, second call returns the first result. → Task 10, Task 11.
2. **Exam deadline passes while the tab is closed or offline**: the server finalizes with saved answers on next access; a late answer save returns `409`. → Task 11.
3. **Network drops while saving an answer**: the client keeps it, shows "not saved yet", retries, and never loses or duplicates it. → Task 15.
4. **Content changes after progress exists** (a question id in stored attempts, review cards or an in-progress assessment no longer exists): it is skipped, never a `500`. → Task 9, Task 11, Task 12.
5. **Time zones**: streaks and review due dates use the learner's calendar day; an invalid or missing time zone string falls back to `UTC`; a day boundary across DST still counts as one day. → Task 8.

---

## File Structure

```
package.json  tsconfig.json  tsconfig.server.json  vite.config.ts  vitest.config.ts
.gitignore  .env.example  README.md
shared/
  types.ts            Question, Answer, PublicQuestion, Feedback, Lesson, Lab, Flashcard, Manifest
  diagrams.ts         DIAGRAM_NAMES (used by content check and client registry)
content/
  manifest.json       all 5 domains / 28 objectives, weights, published flags, question minimums
  domains/1/1.1/lesson.md  questions.json   (and 1.2, 1.3, 1.4)
  labs/lab-1-01.json ...
  flashcards.json
server/src/
  index.ts            read env, connect, migrate, ensureAdmin, listen
  app.ts              createApp(deps): Express
  env.ts              parsed environment
  http.ts             validate(), requireAuth, requireAdmin, requireCsrfHeader, error handler
  content/loader.ts   schema.ts   lesson.ts   check.ts (CLI)
  db/db.ts            migrate.ts   migrations/001_init.sql
  services/           scoring.ts  leitner.ts  xp.ts  time.ts  assembler.ts  mastery.ts  studyPlan.ts
  features/           auth/ admin/ lessons/ answers/ review/ assessments/ labs/ dashboard/ leaderboard/ settings/
                      each: routes.ts + repo.ts (SQL) + *.test.ts
  test/helpers.ts     testApp(), createUser(), loginAs(), fixtureContent()
  test/fixtures/content/   tiny valid content tree for tests
client/
  index.html
  src/main.tsx  App.tsx  routes.tsx  styles.css
  src/api/client.ts  saveQueue.ts
  src/ui/             Button, Card, ProgressRing, MasteryBar, Celebration, AppShell, ThemeToggle
  src/features/       auth/ path/ lesson/ questions/ diagrams/ assessment/ review/ labs/
                      dashboard/ leaderboard/ settings/ admin/
```

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.server.json`, `vite.config.ts`, `vitest.config.ts`, `.gitignore`, `.env.example`, `server/src/index.ts`, `server/src/app.ts`, `server/src/env.ts`, `client/index.html`, `client/src/main.tsx`, `client/src/App.tsx`
- Test: `server/src/app.test.ts`

**Interfaces:**
- Produces: `createApp(deps: AppDeps): Express` in `server/src/app.ts`. In this task `AppDeps = { clientDir?: string }`; later tasks add fields. npm scripts: `dev`, `build`, `start`, `test`, `typecheck`, `check-content`.

- [ ] **Step 1: Prerequisites.** Run `brew install node mysql && brew services start mysql`, then `node -v` (expect v20 or later) and `mysql -uroot -e "CREATE DATABASE IF NOT EXISTS secplus_dev; CREATE DATABASE IF NOT EXISTS secplus_test;"`. Run `git switch -c phase-1`.
- [ ] **Step 2: Create `package.json`** with `"type": "module"`, `"engines": {"node": ">=20"}`, the dependencies in Tech Stack, and scripts: `dev` = `concurrently "tsx watch server/src/index.ts" "vite"`, `build` = `vite build && tsc -p tsconfig.server.json`, `start` = `node dist/server/server/src/index.js`, `test` = `vitest run`, `typecheck` = `tsc --noEmit && tsc -p tsconfig.server.json --noEmit`, `check-content` = `tsx server/src/content/check.ts`. Vite: `root: 'client'`, `build.outDir: '../dist/client'`, dev proxy `/api` → `http://localhost:3000`. Run `npm install`.
- [ ] **Step 3: `.gitignore`** contains `node_modules`, `dist`, `.env`, `.env.*`, `!.env.example`. **`.env.example`** lists `DATABASE_URL=`, `TEST_DATABASE_URL=`, `PORT=3000`, `NODE_ENV=`, `ADMIN_LOGIN=`, `ADMIN_PASSWORD=`, `ADMIN_NAME=` with no values except `PORT`.
- [ ] **Step 4: Write the failing test** in `server/src/app.test.ts`:

```ts
test('health endpoint', async () => {
  const res = await request(createApp({})).get('/api/health');
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ ok: true });
});
test('unknown api route is JSON 404', async () => {
  const res = await request(createApp({})).get('/api/nope');
  expect(res.status).toBe(404);
  expect(res.body).toEqual({ error: 'Not found' });
});
test('non-api paths serve the client index.html', async () => {
  const res = await request(createApp({ clientDir: fixtureDirWithIndexHtml })).get('/dashboard');
  expect(res.status).toBe(200);
  expect(res.text).toContain('<div id="root">');
});
```

- [ ] **Step 5:** Run `npm test`. Expected: FAIL, `createApp` not found.
- [ ] **Step 6: Implement `createApp`** (JSON body limit 100kb, `/api/health`, API 404, static + SPA fallback from `clientDir`) and `index.ts` (listen on `PORT`, `clientDir = dist/client`). Client: an `App` that renders the site name.
- [ ] **Step 7:** Run `npm test && npm run typecheck && npm run build && (PORT=3999 npm start & sleep 2; curl -s localhost:3999/api/health; kill %1)`. Expected: tests PASS, typecheck clean, curl prints `{"ok":true}`.
- [ ] **Step 8: Commit** `chore: scaffold server, client and tooling`.

---

### Task 2: Shared types, manifest, content loader and content check

**Files:**
- Create: `shared/types.ts`, `shared/diagrams.ts`, `content/manifest.json`, `content/flashcards.json` (`[]`), `server/src/content/schema.ts`, `server/src/content/loader.ts`, `server/src/content/check.ts`, `server/src/test/fixtures/content/**`
- Test: `server/src/content/loader.test.ts`

**Interfaces:**
- Produces (`shared/types.ts`):

```ts
export type Item = { id: string; text: string };
type QBase = { id: string; objective: string; difficulty: 1 | 2 | 3; prompt: string; explanation: string };
export type Question =
  | (QBase & { type: 'single'; options: Item[]; correct: string; why: Record<string, string> })
  | (QBase & { type: 'multi'; options: Item[]; correct: string[]; why: Record<string, string> })
  | (QBase & { type: 'order'; items: Item[]; correct: string[] })
  | (QBase & { type: 'match'; left: Item[]; right: Item[]; correct: Record<string, string> })
  | (QBase & { type: 'categorize'; items: Item[]; buckets: Item[]; correct: Record<string, string> });
export type Answer =
  | { type: 'single'; choice: string }
  | { type: 'multi'; choices: string[] }
  | { type: 'order'; order: string[] }
  | { type: 'match'; pairs: Record<string, string> }
  | { type: 'categorize'; placements: Record<string, string> };
export type PublicQuestion = /* Question without correct, explanation, why */;
export type Feedback = { correct: boolean; fraction: number; correctAnswer: Answer; explanation: string; why?: Record<string, string> };
export type Flashcard = { id: string; objective: string; term: string; definition: string };
export type LabStep = Question;            // ids like "lab-1-01-s1"
export type Lab = { id: string; domain: number; objectives: string[]; title: string; scenario: string; steps: LabStep[] };
export type ManifestObjective = { id: string; title: string; published: boolean; minQuestions: number };
export type ManifestDomain = { id: number; title: string; weight: number; mockCount: number; objectives: ManifestObjective[] };
export type Manifest = { exam: 'SY0-701'; domains: ManifestDomain[] };
```

- Produces (`server/src/content/loader.ts`):

```ts
export class ContentError extends Error { constructor(public file: string, public field: string, message: string) }
export type Content = {
  manifest: Manifest;
  questions: Map<string, Question>;
  questionsFor(objective: string): Question[];
  rawLessons: Map<string, string>;          // objective id -> lesson.md source; parsed in Task 3
  labs: Map<string, Lab>;
  flashcards: Flashcard[];
  publishedObjectives(): ManifestObjective[];
  domainOf(objective: string): ManifestDomain;
};
export function loadContent(dir: string): Content;      // throws ContentError
```

- Produces (`shared/diagrams.ts`): `export const DIAGRAM_NAMES = ['control-types-matrix','cia-triad','aaa-flow','zero-trust-planes','change-management-flow','symmetric-vs-asymmetric','hashing-salting','pki-trust-chain','tls-handshake'] as const;`

- [ ] **Step 1: Write `content/manifest.json`.** Domains with `weight` 12/22/18/28/20 and `mockCount` 11/20/16/25/18. All objectives `published: false` for now. `minQuestions`: 30 for `1.4`, 25 for `1.2`, 20 for every other objective. Titles (verify each against CompTIA's SY0-701 objectives PDF before committing):
  - 1.1 Compare and contrast various types of security controls · 1.2 Summarize fundamental security concepts · 1.3 Explain the importance of change management processes and the impact to security · 1.4 Explain the importance of using appropriate cryptographic solutions
  - 2.1 Compare and contrast common threat actors and motivations · 2.2 Explain common threat vectors and attack surfaces · 2.3 Explain various types of vulnerabilities · 2.4 Given a scenario, analyze indicators of malicious activity · 2.5 Explain the purpose of mitigation techniques used to secure the enterprise
  - 3.1 Compare and contrast security implications of different architecture models · 3.2 Given a scenario, apply security principles to secure enterprise infrastructure · 3.3 Compare and contrast concepts and strategies to protect data · 3.4 Explain the importance of resilience and recovery in security architecture
  - 4.1 Given a scenario, apply common security techniques to computing resources · 4.2 Explain the security implications of proper hardware, software, and data asset management · 4.3 Explain various activities associated with vulnerability management · 4.4 Explain security alerting and monitoring concepts and tools · 4.5 Given a scenario, modify enterprise capabilities to enhance security · 4.6 Given a scenario, implement and maintain identity and access management · 4.7 Explain the importance of automation and orchestration related to secure operations · 4.8 Explain appropriate incident response activities · 4.9 Given a scenario, use data sources to support an investigation
  - 5.1 Summarize elements of effective security governance · 5.2 Explain elements of the risk management process · 5.3 Explain the processes associated with third-party risk assessment and management · 5.4 Summarize elements of effective security compliance · 5.5 Explain types and purposes of audits and assessments · 5.6 Given a scenario, implement security awareness practices
- [ ] **Step 2: Build the test fixture** `server/src/test/fixtures/content/`: a manifest with domain 1 (objectives `1.1`, `1.2`, both published, `minQuestions: 3`, `mockCount: 4`) and domain 2 (`2.1`, unpublished, `mockCount: 2`); `1.1` has 12 questions `q-1.1-001`…`012` covering all five types (at least 3 of the PBQ types), `1.2` has 12 `single` questions; one lesson per published objective using a `:::diagram cia-triad` and a `:::check q-1.1-001` directive; one lab `lab-1-01` with 5 steps; 4 flashcards (2 per objective).
- [ ] **Step 3: Write the failing tests** in `loader.test.ts`:

```ts
test('loads fixture content', () => {
  const c = loadContent(FIXTURE);
  expect(c.questions.size).toBe(24);
  expect(c.questionsFor('1.1')).toHaveLength(12);
  expect(c.publishedObjectives().map(o => o.id)).toEqual(['1.1', '1.2']);
  expect(c.domainOf('1.2').id).toBe(1);
});
test.each([
  ['duplicate question id', 'id'],
  ['question objective not in manifest', 'objective'],
  ['single: correct not among option ids', 'correct'],
  ['single: an option has no why entry', 'why'],
  ['order: correct is not a permutation of item ids', 'correct'],
  ['match: a left id has no pair', 'correct'],
  ['categorize: placement names unknown bucket', 'correct'],
  ['empty explanation', 'explanation'],
  ['published objective below minQuestions', 'minQuestions'],
  ['published objective without lesson.md', 'lesson'],
  ['lesson references unknown diagram', 'diagram'],
  ['lesson check references unknown question id', 'check'],
  ['flashcard objective not in manifest', 'objective'],
])('rejects: %s', (_name, field) => {
  expect(() => loadContent(brokenCopyOfFixture(_name))).toThrow(
    expect.objectContaining({ name: 'ContentError', field }));
});
test('real content directory is valid', () => { expect(() => loadContent('content')).not.toThrow(); });
```

`brokenCopyOfFixture(name)` copies the fixture to a temp dir and applies the named mutation.

- [ ] **Step 4:** Run `npx vitest run server/src/content`. Expected: FAIL, `loadContent` not found.
- [ ] **Step 5: Implement** Zod schemas in `schema.ts` and `loadContent` in `loader.ts`. Unpublished objectives may have no files. `check.ts` calls `loadContent('content')`, prints `Content OK: N questions, N lessons, N labs, N flashcards` or `<file>: <field>: <message>` and exits 1.
- [ ] **Step 6:** Run `npx vitest run server/src/content && npm run check-content`. Expected: PASS; `Content OK: 0 questions, 0 lessons, 0 labs, 0 flashcards`.
- [ ] **Step 7: Commit** `feat: content model, loader and content check`.

---

### Task 3: Lesson parser

**Files:**
- Create: `server/src/content/lesson.ts`
- Modify: `shared/types.ts` (add `Lesson` types)
- Test: `server/src/content/lesson.test.ts`

**Interfaces:**
- Consumes: `Content`, `DIAGRAM_NAMES`, `toPublicQuestion` is **not** available yet; this task emits question ids only.
- Produces:

```ts
export type LessonBlock =
  | { kind: 'html'; html: string }
  | { kind: 'diagram'; name: (typeof DIAGRAM_NAMES)[number] }
  | { kind: 'check'; questionId: string };
export type LessonSection = { id: string; title: string; blocks: LessonBlock[] };
export type Lesson = { objective: string; title: string; minutes: number; sections: LessonSection[] };
export function parseLesson(source: string, file: string): Lesson;   // throws ContentError
```

Lesson format: YAML front matter (`objective`, `title`, `minutes`); each `## Heading` starts a section (`id` = `s1`, `s2`, …); a line `:::diagram <name>` or `:::check <question-id>` on its own becomes a block; blockquotes starting `> **Exam tip:**` or `> **Common trap:**` render as `<aside class="callout tip|trap">`. Everything else is Markdown rendered with `marked`.

- [ ] **Step 1: Write the failing tests:**

```ts
const src = `---\nobjective: "1.1"\ntitle: Controls\nminutes: 12\n---\n## Categories\nText **bold**.\n\n:::diagram cia-triad\n\n> **Exam tip:** Watch the verb.\n\n## Types\n:::check q-1.1-001\n`;
test('parses front matter and sections', () => {
  const l = parseLesson(src, 'x.md');
  expect(l).toMatchObject({ objective: '1.1', title: 'Controls', minutes: 12 });
  expect(l.sections.map(s => [s.id, s.title])).toEqual([['s1', 'Categories'], ['s2', 'Types']]);
});
test('emits html, diagram, callout and check blocks in order', () => {
  const [s1, s2] = parseLesson(src, 'x.md').sections;
  expect(s1.blocks.map(b => b.kind)).toEqual(['html', 'diagram', 'html']);
  expect((s1.blocks[0] as any).html).toContain('<strong>bold</strong>');
  expect((s1.blocks[2] as any).html).toContain('class="callout tip"');
  expect(s2.blocks).toEqual([{ kind: 'check', questionId: 'q-1.1-001' }]);
});
test('rejects missing front matter field', () =>
  expect(() => parseLesson('## A\ntext', 'x.md')).toThrow(expect.objectContaining({ field: 'objective' })));
test('rejects a lesson with no sections', () =>
  expect(() => parseLesson('---\nobjective: "1.1"\ntitle: T\nminutes: 5\n---\ntext', 'x.md')).toThrow(expect.objectContaining({ field: 'sections' })));
test('raw HTML in markdown is escaped', () =>
  expect(JSON.stringify(parseLesson(src.replace('Text', '<script>x</script>'), 'x.md'))).not.toContain('<script>'));
```

- [ ] **Step 2:** Run `npx vitest run server/src/content/lesson`. Expected: FAIL.
- [ ] **Step 3: Implement `parseLesson`.** Then change `Content.rawLessons` to `lessons: Map<string, Lesson>` in `loader.ts`, parsing at load and validating diagram names and check ids there (the Task 2 tests for those two fields keep passing).
- [ ] **Step 4:** Run `npx vitest run server/src/content`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: lesson markdown parser`.

---

### Task 4: Scoring service

**Files:**
- Create: `server/src/services/scoring.ts`
- Test: `server/src/services/scoring.test.ts`

**Interfaces:**
- Produces:

```ts
export const answerSchema: z.ZodType<Answer>;
export function grade(q: Question, a: Answer): { correct: boolean; fraction: number };  // throws AnswerShapeError if a.type !== q.type or ids are unknown
export class AnswerShapeError extends Error {}
export function feedbackFor(q: Question, a: Answer): Feedback;
export function toPublicQuestion(q: Question, seed: string): PublicQuestion;  // strips answers; deterministic shuffle of options/items/left/right by seed
```

Rules: `correct` is all-or-nothing. `fraction`: single 0 or 1; multi `max(0, hits − wrongPicks) / correct.length`; order = share of positions correct; match and categorize = share of items placed correctly.

- [ ] **Step 1: Write the failing tests:**

```ts
test('single', () => {
  expect(grade(single, { type: 'single', choice: 'b' })).toEqual({ correct: true, fraction: 1 });
  expect(grade(single, { type: 'single', choice: 'a' })).toEqual({ correct: false, fraction: 0 });
});
test('multi: order-insensitive, partial fraction, wrong picks subtract', () => {
  expect(grade(multi, { type: 'multi', choices: ['c', 'a'] }).correct).toBe(true);      // correct = ['a','c']
  expect(grade(multi, { type: 'multi', choices: ['a'] })).toEqual({ correct: false, fraction: 0.5 });
  expect(grade(multi, { type: 'multi', choices: ['a', 'b'] })).toEqual({ correct: false, fraction: 0 });
});
test('order', () => {
  expect(grade(order, { type: 'order', order: ['1', '2', '3', '4'] }).correct).toBe(true);
  expect(grade(order, { type: 'order', order: ['2', '1', '3', '4'] })).toEqual({ correct: false, fraction: 0.5 });
});
test('match and categorize give share placed correctly', () => {
  expect(grade(match, { type: 'match', pairs: { l1: 'r1', l2: 'r3', l3: 'r2' } }).fraction).toBeCloseTo(1 / 3);
  expect(grade(cat, { type: 'categorize', placements: cat.correct }).correct).toBe(true);
});
test.each([
  ['type mismatch', single, { type: 'multi', choices: ['a'] }],
  ['unknown option id', single, { type: 'single', choice: 'zzz' }],
  ['order missing an item', order, { type: 'order', order: ['1', '2'] }],
  ['order with a duplicate', order, { type: 'order', order: ['1', '1', '3', '4'] }],
  ['multi with a duplicate', multi, { type: 'multi', choices: ['a', 'a'] }],
])('rejects %s', (_n, q, a) => expect(() => grade(q as any, a as any)).toThrow(AnswerShapeError));
test('toPublicQuestion strips answers and is deterministic', () => {
  for (const q of [single, multi, order, match, cat]) {
    const p = toPublicQuestion(q, 'seed') as any;
    expect(p.correct).toBeUndefined(); expect(p.explanation).toBeUndefined(); expect(p.why).toBeUndefined();
    expect(toPublicQuestion(q, 'seed')).toEqual(p);
  }
});
test('order items are not served in the correct order', () => {
  const p = toPublicQuestion(order, 'any-seed') as any;
  expect(p.items.map((i: Item) => i.id)).not.toEqual(order.correct);
});
test('feedbackFor includes correct answer, explanation and why', () =>
  expect(feedbackFor(single, { type: 'single', choice: 'a' })).toEqual({
    correct: false, fraction: 0, correctAnswer: { type: 'single', choice: 'b' },
    explanation: single.explanation, why: single.why }));
```

- [ ] **Step 2:** Run `npx vitest run server/src/services/scoring`. Expected: FAIL.
- [ ] **Step 3: Implement.** Shuffle: seeded Fisher–Yates using a hash of `seed + q.id`; for `order`, if the shuffled result equals `correct`, rotate by one.
- [ ] **Step 4:** Run again. Expected: PASS.
- [ ] **Step 5: Commit** `feat: scoring service for all question types`.

---

### Task 5: Database, migrations and test helpers

**Files:**
- Create: `server/src/db/db.ts`, `server/src/db/migrate.ts`, `server/src/db/migrations/001_init.sql`, `server/src/test/helpers.ts`
- Modify: `server/src/app.ts`, `server/src/index.ts`, `vitest.config.ts` (`fileParallelism: false` for server tests; they share one database)
- Test: `server/src/db/migrate.test.ts`

**Interfaces:**
- Produces:

```ts
export type Db = {
  query<T = any>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string, params?: unknown[]): Promise<{ insertId: number; affectedRows: number }>;
  tx<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
};
export function connect(url: string): Db;                       // pool; timezone 'Z'; dateStrings for DATE columns
export async function migrate(db: Db, dir?: string): Promise<string[]>;   // returns names applied
// app.ts
export type AppDeps = { db: Db; content: Content; now: () => Date; clientDir?: string; secureCookies: boolean };
// test/helpers.ts
export async function testApp(opts?: { now?: () => Date }): Promise<{ app: Express; db: Db; content: Content; setNow(d: Date): void }>;  // migrates, truncates every table, uses fixtureContent()
export async function createUser(db: Db, o?: Partial<{ login: string; name: string; password: string; role: 'learner' | 'admin'; timeZone: string; active: boolean }>): Promise<{ id: number; login: string; password: string }>;
export async function loginAs(app: Express, user: { login: string; password: string }): Promise<TestAgent>;   // supertest agent with session cookie and X-Requested-With header preset
export function fixtureContent(): Content;
```

Schema (`001_init.sql`, all tables InnoDB utf8mb4, all timestamps `DATETIME(3)` UTC):

| Table | Columns |
|---|---|
| `users` | `id` PK AI, `login` VARCHAR(64) UNIQUE, `name` VARCHAR(64), `password_hash` VARCHAR(100), `role` ENUM('learner','admin'), `time_zone` VARCHAR(64) DEFAULT 'UTC', `exam_date` DATE NULL, `active` BOOL DEFAULT 1, `hide_from_leaderboard` BOOL DEFAULT 0, `created_at`, `last_active_at` NULL |
| `invites` | `id`, `token_hash` CHAR(64) UNIQUE, `purpose` ENUM('invite','reset'), `user_id` NULL FK, `created_by` FK, `expires_at`, `used_at` NULL |
| `sessions` | `id_hash` CHAR(64) PK, `user_id` FK, `expires_at` |
| `lesson_progress` | PK (`user_id`,`objective`), `sections_done` JSON, `completed_at` NULL |
| `attempts` | `id`, `user_id` FK, `question_id` VARCHAR(40), `correct` BOOL, `context` ENUM('lesson','quiz','review','exam','lab'), `assessment_id` NULL, `created_at`; INDEX (`user_id`,`question_id`,`created_at`); UNIQUE (`assessment_id`,`question_id`) |
| `review_cards` | PK (`user_id`,`card_id` VARCHAR(48)), `box` TINYINT, `due_on` DATE; INDEX (`user_id`,`due_on`) |
| `assessments` | `id`, `user_id` FK, `kind` ENUM('objective','domain','mock'), `scope` VARCHAR(8) NULL, `question_ids` JSON, `answers` JSON, `flags` JSON, `started_at`, `deadline_at` NULL, `submitted_at` NULL, `score_pct` DECIMAL(5,2) NULL, `scaled_score` INT NULL, `passed` BOOL NULL, `breakdown` JSON NULL |
| `lab_results` | `id`, `user_id` FK, `lab_id` VARCHAR(40), `score_pct` DECIMAL(5,2), `passed` BOOL, `created_at` |
| `xp_events` | `id`, `user_id` FK, `amount` INT, `reason` VARCHAR(32), `ref` VARCHAR(64), `created_at`; UNIQUE (`user_id`,`reason`,`ref`); INDEX (`user_id`,`created_at`) |
| `badges` | PK (`user_id`,`badge_id` VARCHAR(32)), `earned_at` |

All FKs `ON DELETE CASCADE`.

- [ ] **Step 1: Write the failing tests:**

```ts
test('migrate applies once and is idempotent', async () => {
  const db = connect(process.env.TEST_DATABASE_URL!);
  await dropAllTables(db);
  expect(await migrate(db)).toEqual(['001_init.sql']);
  expect(await migrate(db)).toEqual([]);
  const t = await db.query<{ n: number }>("SELECT COUNT(*) n FROM information_schema.tables WHERE table_schema = DATABASE()");
  expect(Number(t[0].n)).toBe(11);     // 10 tables + schema_migrations
});
test('tx rolls back on throw', async () => {
  const { db } = await testApp();
  await expect(db.tx(async tx => { await createUser(tx); throw new Error('x'); })).rejects.toThrow('x');
  expect(await db.query('SELECT id FROM users')).toHaveLength(0);
});
test('testApp fails loudly without TEST_DATABASE_URL', async () => {
  /* with the variable unset */ await expect(testApp()).rejects.toThrow('TEST_DATABASE_URL');
});
```

- [ ] **Step 2:** Add `TEST_DATABASE_URL=mysql://root@localhost/secplus_test` and `DATABASE_URL=mysql://root@localhost/secplus_dev` to a local `.env` (git-ignored); load it in `vitest.config.ts` and `env.ts`. Run `npx vitest run server/src/db`. Expected: FAIL.
- [ ] **Step 3: Implement** `connect`, `migrate` (table `schema_migrations(name, applied_at)`), the SQL file, and the helpers. `index.ts`: `connect` → `migrate` → `loadContent('content')` → `createApp` → listen; if the database is unreachable at start, log and exit 1. Add to `createApp` an error handler mapping database connection errors to `503 {error:'Service unavailable'}` and everything else to `500 {error:'Server error'}` without leaking details.
- [ ] **Step 4:** Run `npm test`. Expected: PASS (update the Task 1 tests to use `testApp()`).
- [ ] **Step 5: Commit** `feat: database layer, schema and test helpers`.

---

### Task 6: Authentication, invites and security middleware

**Files:**
- Create: `server/src/http.ts`, `server/src/features/auth/routes.ts`, `server/src/features/auth/repo.ts`, `server/src/features/auth/tokens.ts`
- Modify: `server/src/app.ts`, `server/src/index.ts`
- Test: `server/src/features/auth/auth.test.ts`

**Interfaces:**
- Produces (`http.ts`): `validate(schema)`, `requireAuth` (sets `req.user: { id; login; name; role; timeZone }`, 401 otherwise, updates `last_active_at` at most once a minute), `requireAdmin` (403), `requireCsrfHeader`.
- Produces (`tokens.ts`): `newToken(): { token: string; hash: string }` (32 random bytes, base64url; SHA-256 hex), `hashToken(t: string): string`.
- Produces (`repo.ts`): `createInvite(db, { purpose, userId?, createdBy, now }): Promise<string /* token */>`, `ensureAdmin(db, env, now): Promise<void>`.
- Routes: `POST /api/auth/login {login, password}` → `{user}`; `POST /api/auth/logout`; `GET /api/auth/me` → `{user}` or 401; `GET /api/auth/invite/:token` → `{purpose, name?}` or 404; `POST /api/auth/accept-invite {token, login, name, password, timeZone}`; `POST /api/auth/reset {token, password}`.

Fixed values: cookie name `sid`, `HttpOnly`, `SameSite=Lax`, `Secure` when `deps.secureCookies`, path `/`, 30-day sliding expiry. Every non-GET `/api` request must carry header `X-Requested-With: secplus`, else `403`. Login limits: 10 attempts per IP per 15 minutes (`express-rate-limit`), and 5 failures per login name per 15 minutes held in memory → `429`. Login failures return the same `401 {error:'Invalid login or password'}` whether the login exists or not, and always run one bcrypt comparison. `login`: 3–64 chars `[a-z0-9._-]`, lower-cased. Invites expire 7 days after creation. Helmet with CSP `default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; script-src 'self'; frame-ancestors 'none'`.

- [ ] **Step 1: Write the failing tests** (each a separate `test`):

```ts
// login
'valid login sets HttpOnly SameSite=Lax sid cookie and returns user without password_hash'
'wrong password and unknown login both return 401 with identical body'
'inactive user cannot log in (401)'
'6th failed attempt for one login within 15 minutes returns 429, and a correct password is also refused until the window passes (advance now by 15 min -> 200)'
'me returns 401 without a cookie and the user with one'
'logout deletes the session row; the old cookie then gets 401'
'a session past expires_at gets 401'
'sessions table stores a 64-char hash, never the cookie value'
// csrf + headers
'POST without X-Requested-With returns 403'
'responses carry content-security-policy and x-content-type-options headers'
// invites
'accept-invite creates an active learner, marks the invite used, and logs them in'
'accept-invite rejects: used token (410), expired token (410), unknown token (404), password under 12 chars (400), taken login (409), invalid login characters (400)'
'accept-invite with an invalid time zone stores UTC'
'reset changes the password, marks the token used, and deletes all of that user's sessions'
'a reset token cannot be used on accept-invite and vice versa (404)'
'invites table stores only token_hash'
// bootstrap
'ensureAdmin creates an admin from ADMIN_LOGIN/ADMIN_PASSWORD/ADMIN_NAME when no admin exists'
'ensureAdmin does nothing when an admin exists, and throws if no admin exists and ADMIN_PASSWORD is under 12 chars'
```

- [ ] **Step 2:** Run `npx vitest run server/src/features/auth`. Expected: FAIL.
- [ ] **Step 3: Implement.** Call `ensureAdmin` in `index.ts` after `migrate`. Expired sessions and invites are deleted opportunistically on login.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: invite-only authentication and security middleware`.

---

### Task 7: Admin API

**Files:**
- Create: `server/src/features/admin/routes.ts`, `server/src/features/admin/repo.ts`
- Test: `server/src/features/admin/admin.test.ts`

**Interfaces:**
- Consumes: `requireAdmin`, `createInvite`.
- Routes: `GET /api/admin/users` → `{users: [{id, login, name, role, active, lastActiveAt, domainsPassed: number[], latestMockScore: number | null}]}`; `POST /api/admin/invites {purpose: 'invite'}` or `{purpose: 'reset', userId}` → `{url, expiresAt}` where `url` is `/invite/<token>` or `/reset/<token>`; `PATCH /api/admin/users/:id {active: boolean}`.

- [ ] **Step 1: Write the failing tests:**

```ts
'learner gets 403 on every admin route; anonymous gets 401'
'invite url token is accepted by accept-invite'
'reset invite requires an existing userId (404 otherwise)'
'deactivating a user deletes their sessions and blocks login'
'an admin cannot deactivate themselves (400)'
'users list includes domainsPassed and latestMockScore from assessments, and never password_hash'
```

- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3: Implement.** `domainsPassed` = distinct `scope` of passed `domain` assessments; `latestMockScore` = `scaled_score` of the most recent submitted `mock`.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: admin API for learners, invites and resets`.

---

### Task 8: XP, levels, streaks and badges

**Files:**
- Create: `server/src/services/time.ts`, `server/src/services/xp.ts`, `server/src/features/xp/repo.ts`
- Test: `server/src/services/time.test.ts`, `server/src/services/xp.test.ts`, `server/src/features/xp/repo.test.ts`

**Interfaces:**
- Produces (`time.ts`):

```ts
export function safeTimeZone(tz: string | null | undefined): string;        // valid IANA name or 'UTC'
export function localDate(at: Date, tz: string): string;                     // 'YYYY-MM-DD' in tz
export function addDays(date: string, n: number): string;
export function weekStartUtc(at: Date): Date;                                // Monday 00:00 UTC
export function streak(activeDates: string[], today: string): number;        // consecutive days ending today or yesterday
```

- Produces (`xp.ts`):

```ts
export const XP = { lessonComplete: 50, firstCorrect: 10 /* × difficulty */, repeatCorrect: 2, flashcardKnown: 2,
  objectiveQuizPass: 100, domainExamPass: 300, mockExamPass: 500, labPass: 75 } as const;
export function levelForXp(xp: number): number;        // 1 + floor(sqrt(xp / 100))
export function xpForLevel(level: number): number;     // 100 × (level − 1)²
export const BADGES: { id: string; title: string; description: string }[];
// ids: first-lesson, first-quiz-pass, domain-1-complete, streak-3, streak-7, streak-30, hundred-correct, lab-rat, first-mock-pass
```

- Produces (`features/xp/repo.ts`):

```ts
export async function awardXp(db: Db, e: { userId: number; amount: number; reason: string; ref: string; now: Date }): Promise<boolean>;  // false if (user, reason, ref) already exists
export async function totals(db: Db, userId: number, tz: string, now: Date): Promise<{ xp: number; level: number; streak: number }>;
export async function evaluateBadges(db: Db, userId: number, tz: string, now: Date): Promise<string[]>;  // newly earned ids
```

`reason`/`ref` conventions used by later tasks: `lesson`/objective id; `first-correct`/question id; `repeat-correct`/`<questionId>@<localDate>`; `flashcard`/`<cardId>@<localDate>`; `quiz-pass`/objective id; `domain-pass`/domain id; `mock-pass`/assessment id; `lab-pass`/lab id. Badge rules: `hundred-correct` = 100 correct attempts; `lab-rat` = 3 distinct labs passed; `domain-1-complete` = passed domain 1 exam; streak badges from `streak`.

- [ ] **Step 1: Write the failing tests:**

```ts
test('safeTimeZone', () => {
  expect(safeTimeZone('America/Chicago')).toBe('America/Chicago');
  for (const bad of ['Mars/Olympus', '', null, undefined, '<script>']) expect(safeTimeZone(bad as any)).toBe('UTC');
});
test('localDate uses the learner calendar day', () => {
  const at = new Date('2026-11-11T03:30:00Z');
  expect(localDate(at, 'America/Chicago')).toBe('2026-11-10');
  expect(localDate(at, 'UTC')).toBe('2026-11-11');
});
test('addDays across a DST change and month end', () => {
  expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
  expect(addDays('2026-03-07', 2)).toBe('2026-03-09');
});
test('weekStartUtc', () => {
  expect(weekStartUtc(new Date('2026-11-11T12:00:00Z')).toISOString()).toBe('2026-11-09T00:00:00.000Z');
  expect(weekStartUtc(new Date('2026-11-09T00:00:00Z')).toISOString()).toBe('2026-11-09T00:00:00.000Z');
  expect(weekStartUtc(new Date('2026-11-15T23:59:59Z')).toISOString()).toBe('2026-11-09T00:00:00.000Z');
});
test('streak', () => {
  expect(streak([], '2026-11-10')).toBe(0);
  expect(streak(['2026-11-10'], '2026-11-10')).toBe(1);
  expect(streak(['2026-11-08', '2026-11-09'], '2026-11-10')).toBe(2);          // yesterday keeps it alive
  expect(streak(['2026-11-07', '2026-11-08'], '2026-11-10')).toBe(0);          // gap
  expect(streak(['2026-11-10', '2026-11-10', '2026-11-09', '2026-11-07'], '2026-11-10')).toBe(2);
  expect(streak(['2026-10-31', '2026-11-01', '2026-11-02'], '2026-11-02')).toBe(3);   // US DST ends Nov 1
});
test('levels', () => {
  expect([0, 99, 100, 399, 400, 900].map(levelForXp)).toEqual([1, 1, 2, 2, 3, 4]);
  expect(xpForLevel(3)).toBe(400);
});
test('awardXp is idempotent per (user, reason, ref)', async () => {
  expect(await awardXp(db, { userId, amount: 50, reason: 'lesson', ref: '1.1', now })).toBe(true);
  expect(await awardXp(db, { userId, amount: 50, reason: 'lesson', ref: '1.1', now })).toBe(false);
  expect((await totals(db, userId, 'UTC', now)).xp).toBe(50);
});
test('totals streak uses the user time zone', async () => { /* events at 2026-11-10T03:00Z and 2026-11-11T03:00Z: streak 2 in UTC and 2 in America/Chicago (Nov 9, Nov 10) as of 2026-11-11T04:00Z */ });
test('evaluateBadges returns each badge once', async () => { /* 3 active days -> ['streak-3']; second call -> [] */ });
```

- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3: Implement.** `localDate` via `Intl.DateTimeFormat('en-CA', { timeZone })`. `awardXp` uses `INSERT IGNORE` and `affectedRows`.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: XP, levels, streaks and badges`.

---

### Task 9: Review scheduler and review API

**Files:**
- Create: `server/src/services/leitner.ts`, `server/src/features/review/routes.ts`, `server/src/features/review/repo.ts`
- Test: `server/src/services/leitner.test.ts`, `server/src/features/review/review.test.ts`

**Interfaces:**
- Consumes: `grade`, `feedbackFor`, `toPublicQuestion`, `awardXp`, `localDate`, `addDays`, `XP`.
- Produces (`leitner.ts`): `INTERVALS = [1, 2, 4, 8, 16]`; `nextBox(box: number, correct: boolean): number`; `dueOn(box: number, today: string): string`.
- Produces (`review/repo.ts`):

```ts
export async function scheduleMiss(db: Db, userId: number, cardId: string, today: string): Promise<void>;   // upsert to box 1, due tomorrow
export async function addFlashcards(db: Db, userId: number, flashcardIds: string[], today: string): Promise<void>;  // insert-if-absent, box 1, due today
export async function dueCount(db: Db, content: Content, userId: number, today: string): Promise<number>;
```

- Card ids: `q:<questionId>`, `f:<flashcardId>`.
- Routes: `GET /api/review/due` → `{total, cards: Array<{cardId, kind:'question', question: PublicQuestion} | {cardId, kind:'flashcard', term}>}` (at most 30, oldest due first); `POST /api/review/:cardId` with `{answer}` (question) or `{knewIt: boolean}` (flashcard) → `{box, dueOn, feedback?: Feedback, definition?: string, xp: number}`; `GET /api/review/flashcard/:cardId` → `{definition}` (reveal).

- [ ] **Step 1: Write the failing tests:**

```ts
test('nextBox', () => {
  expect([1, 2, 3, 4, 5].map(b => nextBox(b, true))).toEqual([2, 3, 4, 5, 5]);
  expect([1, 3, 5].map(b => nextBox(b, false))).toEqual([1, 1, 1]);
});
test('dueOn', () => expect([1, 2, 3, 4, 5].map(b => dueOn(b, '2026-11-10')))
  .toEqual(['2026-11-11', '2026-11-12', '2026-11-14', '2026-11-18', '2026-11-26']));
// API
'due lists only cards with due_on <= today in the learner time zone, and no answers or definitions'
'correct question review moves box 1 -> 2, due in 2 days, records an attempt with context review, awards repeatCorrect XP once per day'
'wrong review resets a box-4 card to box 1 due tomorrow and returns feedback'
'flashcard knewIt=true promotes and awards flashcardKnown XP; knewIt=false resets'
'reviewing a card that is not due returns 409'
'reviewing another learner's card returns 404'
'a card whose question or flashcard id no longer exists in content is omitted from due, excluded from dueCount, and POST to it returns 404 (not 500)'
'scheduleMiss on an existing box-3 card resets it to box 1'
'addFlashcards does not reset cards the learner already has'
```

- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: spaced-repetition review`.

---

### Task 10: Lessons API and answers API

**Files:**
- Create: `server/src/features/lessons/routes.ts`, `server/src/features/lessons/repo.ts`, `server/src/features/answers/routes.ts`, `server/src/features/answers/repo.ts`, `server/src/features/access.ts`
- Test: `server/src/features/lessons/lessons.test.ts`, `server/src/features/answers/answers.test.ts`

**Interfaces:**
- Consumes: Tasks 3, 4, 8, 9.
- Produces (`access.ts`): `async function unlockedDomains(db: Db, content: Content, userId: number): Promise<number[]>` — domain 1 always; domain N when the learner has a passed `domain` assessment with scope `N−1`. `async function assertObjectiveOpen(...)`: throws `HttpError(404)` for unknown or unpublished objectives, `HttpError(403)` for locked domains.
- Produces (`answers/repo.ts`):

```ts
export async function recordAnswer(db: Db, content: Content, a: {
  user: { id: number; timeZone: string }; question: Question; answer: Answer;
  context: 'lesson' | 'quiz' | 'review' | 'exam' | 'lab'; assessmentId?: number; now: Date;
}): Promise<{ feedback: Feedback; xp: number; newBadges: string[] }>;
```

  It grades, inserts the attempt, awards `XP.firstCorrect × difficulty` on the learner's first correct answer to that question (else `XP.repeatCorrect` once per local day), calls `scheduleMiss` when wrong (except context `lab`), and evaluates badges. Used by Tasks 9, 11 and 14.
- Routes: `GET /api/lessons/:objective` → `{lesson, progress: {sectionsDone: string[], completedAt}}` where `check` blocks carry `question: PublicQuestion`; `POST /api/lessons/:objective/progress {sectionId}` → `{sectionsDone, completedAt, xp, newBadges}`; `POST /api/answers {questionId, answer}` (lesson checks and "practice now") → `{feedback, xp, newBadges}`.

- [ ] **Step 1: Write the failing tests:**

```ts
// lessons
'GET returns sections; check blocks contain a PublicQuestion with no correct/explanation/why anywhere in the JSON'
'unknown objective 404; unpublished objective 404; objective in a locked domain 403'
'marking the last section sets completedAt, awards 50 XP once, adds the objective's flashcards as review cards, returns first-lesson badge'
'marking the same section twice is a no-op; unknown sectionId is 400'
// answers
'correct first answer: attempt row, XP 10 × difficulty, feedback.correct true'
'second correct answer the same day awards 2 XP; a third the same day awards 0'
'wrong answer: no XP, creates review card q:<id> in box 1 due tomorrow, feedback has correctAnswer, explanation and why'
'answer whose type does not match the question returns 400; unknown questionId returns 404'
'question in a locked domain returns 403'
'two identical POSTs in parallel (Promise.all) leave first-correct XP awarded exactly once'
```

- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3: Implement.** `HttpError(status, message)` lives in `http.ts` and is mapped by the error handler.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: lessons and answers API`.

---

### Task 11: Assessments (objective quiz, domain exam, mock exam)

**Files:**
- Create: `server/src/services/assembler.ts`, `server/src/features/assessments/routes.ts`, `server/src/features/assessments/repo.ts`
- Test: `server/src/services/assembler.test.ts`, `server/src/features/assessments/assessments.test.ts`

**Interfaces:**
- Consumes: `recordAnswer`, `grade`, `toPublicQuestion`, `awardXp`, `unlockedDomains`.
- Produces (`assembler.ts`, pure):

```ts
export type Rng = () => number;
export function seededRng(seed: string): Rng;
export function pickQuiz(pool: Question[], lastSeen: Map<string, number>, n: number, rng: Rng): string[];   // least recently seen first, ties random
export function pickMock(content: Content, lastSeen: Map<string, number>, rng: Rng):
  { questionIds: string[]; minutes: number; partial: boolean };
export function scaledScore(fraction: number): number;          // round(100 + 800 × fraction)
export const PASS = { objective: 80, domain: 75, mockScaled: 750 } as const;
```

  `pickMock`: for each **published** domain draw `mockCount` questions spread as evenly as possible across its published objectives (fewer if the pool is short); up to 3 PBQ-type questions (`order`, `match`, `categorize`) are moved to the front; `minutes` = number of questions; `partial` = any domain has no published objective.
- Routes:
  - `POST /api/assessments {kind: 'objective', scope: '1.1'} | {kind: 'domain', scope: '1'} | {kind: 'mock'}` → `201 {id}`. If the learner already has an unsubmitted assessment of the same kind and scope, return it (`200 {id}`) instead of creating another.
  - `GET /api/assessments/:id` → `{id, kind, scope, partial, questions: PublicQuestion[], answers: Record<questionId, Answer>, flags: string[], feedback: Record<questionId, Feedback>, deadlineAt, submittedAt, result?}`. `feedback` is populated for `objective` as each question is answered, and for every question once submitted; otherwise `{}`.
  - `PUT /api/assessments/:id/answers {questionId, answer?, flagged?}` → `objective`: `{feedback}` and the answer is final; `domain`/`mock`: `{saved: true}` and the answer may be changed until submit.
  - `POST /api/assessments/:id/submit` → `{result: {scorePct, scaledScore?, passed, byDomain: Record<string, {correct, total}>, byObjective: Record<string, {correct, total}>, xp, newBadges}}`.

Fixed values: objective quiz = 10 questions from that objective, no deadline. Domain exam = 25 questions spread evenly across the domain's published objectives (all of them if fewer than 25 exist), deadline 25 minutes. Mock per `pickMock`. Unanswered questions count as wrong. Attempts are written at answer time for `objective` (context `quiz`) and at submit for the others (context `exam`). XP on pass: `quiz-pass`, `domain-pass`, `mock-pass` (see Task 8), each once.

- [ ] **Step 1: Write the failing tests:**

```ts
// assembler
test('pickQuiz prefers unseen then oldest-seen, no duplicates', () => { /* pool of 12, 5 seen: all 7 unseen are in a pick of 10, plus the 3 oldest seen */ });
test('pickQuiz returns the whole pool when n exceeds it', () => {});
test('pickMock on fixture content', () => {
  const m = pickMock(fixtureContent(), new Map(), seededRng('x'));
  expect(m.questionIds).toHaveLength(4);                       // domain 1 mockCount 4; domain 2 unpublished
  expect(new Set(m.questionIds).size).toBe(4);
  expect(m.minutes).toBe(4); expect(m.partial).toBe(true);
  const types = m.questionIds.map(id => fixtureContent().questions.get(id)!.type);
  const firstNonPbq = types.findIndex(t => t === 'single' || t === 'multi');
  expect(types.slice(firstNonPbq).every(t => t === 'single' || t === 'multi')).toBe(true);   // PBQs first
  expect(firstNonPbq).toBeLessThanOrEqual(3);
});
test('pickMock with a full synthetic manifest returns 90 questions split 11/20/16/25/18, 90 minutes, partial false', () => {});
test('scaledScore', () => expect([0, 0.8125, 1, 0.5].map(scaledScore)).toEqual([100, 750, 900, 500]));
// API — objective quiz
'start returns 201 with 10 PublicQuestions and no answer data in the JSON'
'starting again while one is open returns the same id'
'PUT answer returns feedback; GET then includes that feedback; changing a final answer returns 409'
'the same PUT sent twice in parallel creates one attempt row'
'submit with 8/10 correct: scorePct 80, passed true, 100 XP; 7/10: passed false, no XP'
'unanswered questions count as wrong'
// API — domain exam and mock
'PUT returns {saved:true} with no feedback; GET before submit has feedback {} and no answer data'
'answers can be changed before submit; flags round-trip'
'submit writes one attempt per answered question with context exam and schedules misses for review'
'domain exam at 75% passes, unlocks the next domain in unlockedDomains, awards 300 XP once across two passing attempts'
'mock result has scaledScore and byDomain; passing at >= 750 awards 500 XP'
'after deadline: PUT returns 409; GET returns the assessment already finalized with saved answers scored'
'submit twice returns the same result and awards XP once'
'another learner gets 404 on GET, PUT and submit'
'PUT for a questionId not in the assessment returns 400'
'if a stored question id no longer exists in content, GET omits it and submit scores the rest (no 500)'
'domain exam for a locked domain returns 403; unknown scope 404'
```

- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3: Implement.** `finalize(db, content, assessment, now)` is the single scoring path, called by submit and lazily by any access after `deadline_at`; it runs in a transaction that locks the assessment row (`SELECT … FOR UPDATE`) and is a no-op when `submitted_at` is set. `lastSeen` comes from the learner's latest attempt time per question.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: quizzes, domain exams and mock exams`.

---

### Task 12: Mastery, readiness, study plan, path, dashboard and settings

**Files:**
- Create: `server/src/services/mastery.ts`, `server/src/services/studyPlan.ts`, `server/src/features/dashboard/routes.ts`, `server/src/features/dashboard/repo.ts`, `server/src/features/settings/routes.ts`
- Test: `server/src/services/mastery.test.ts`, `server/src/services/studyPlan.test.ts`, `server/src/features/dashboard/dashboard.test.ts`

**Interfaces:**
- Consumes: `unlockedDomains`, `totals`, `dueCount`, `BADGES`.
- Produces (pure):

```ts
// mastery.ts
export function objectiveMastery(questionIds: string[], latestCorrect: Map<string, boolean>): number;       // 0–100, share whose latest attempt is correct; 0 when no questions
export function domainMastery(objs: { mastery: number; questionCount: number }[]): number;                  // weighted by questionCount
export function readiness(i: { domainMastery: Record<number, number>; lastMockScores: number[]; allDomainsPublished: boolean }):
  { ready: boolean; missing: string[] };
// studyPlan.ts
export function studyPlan(i: { today: string; examDate: string | null; objectivesRemaining: number; reviewsDue: number }):
  { daysLeft: number; objectivesPerDay: number; message: string } | null;
```

  `readiness`: ready only when `allDomainsPublished`, there are at least 3 mock scores with mean ≥ 800, and every domain ≥ 80. `missing` holds one sentence per unmet condition, e.g. `"Content for all five domains is not available yet"`, `"Take 2 more mock exams"`, `"Average of last three mock exams is 742; aim for 800"`, `"Domain 2 mastery is 64%; aim for 80%"`.
  `studyPlan`: `null` without an exam date; `daysLeft` = whole days from today to exam date (0 if today, negative if past); `objectivesPerDay` = `ceil(remaining / max(daysLeft, 1))`.
- Routes:
  - `GET /api/path` → `{domains: [{id, title, weight, unlocked, examPassed, hasContent, objectives: [{id, title, published, lessonDone, quizPassed, mastery}]}]}`
  - `GET /api/dashboard` → `{xp, level, nextLevelXp, streak, reviewsDue, domains: [{id, title, mastery}], weakest: [{objective, title, mastery}], mockHistory: [{id, submittedAt, scaledScore, passed, partial}], readiness, studyPlan, badges: [{id, title, description, earnedAt | null}]}`. `weakest` = up to 5 published objectives in unlocked domains with the lowest mastery among those with at least one attempt.
  - `GET /api/practice/:objective` → `{questions: PublicQuestion[]}`: up to 10 questions whose latest attempt is wrong or missing (for "practice now"; answered through `POST /api/answers`).
  - `PUT /api/settings {name?, timeZone?, examDate?: string | null, hideFromLeaderboard?}` → `{user}`.

- [ ] **Step 1: Write the failing tests:**

```ts
test('objectiveMastery', () => {
  expect(objectiveMastery(['a', 'b', 'c', 'd'], new Map([['a', true], ['b', false], ['c', true]]))).toBe(50);
  expect(objectiveMastery([], new Map())).toBe(0);
  expect(objectiveMastery(['a'], new Map([['a', true], ['gone', true]]))).toBe(100);     // attempts on removed questions ignored
});
test('domainMastery weights by question count', () =>
  expect(domainMastery([{ mastery: 100, questionCount: 30 }, { mastery: 0, questionCount: 10 }])).toBe(75));
test('readiness', () => {
  const all = { 1: 85, 2: 90, 3: 80, 4: 82, 5: 95 };
  expect(readiness({ domainMastery: all, lastMockScores: [820, 790, 800], allDomainsPublished: true })).toEqual({ ready: true, missing: [] });
  expect(readiness({ domainMastery: all, lastMockScores: [820, 790, 780], allDomainsPublished: true }).ready).toBe(false);
  expect(readiness({ domainMastery: { ...all, 2: 64 }, lastMockScores: [900, 900, 900], allDomainsPublished: true }).missing)
    .toEqual(['Domain 2 mastery is 64%; aim for 80%']);
  expect(readiness({ domainMastery: all, lastMockScores: [900], allDomainsPublished: true }).missing).toEqual(['Take 2 more mock exams']);
  expect(readiness({ domainMastery: all, lastMockScores: [900, 900, 900], allDomainsPublished: false }).ready).toBe(false);
});
test('studyPlan', () => {
  expect(studyPlan({ today: '2026-11-10', examDate: null, objectivesRemaining: 5, reviewsDue: 0 })).toBeNull();
  expect(studyPlan({ today: '2026-11-10', examDate: '2026-11-20', objectivesRemaining: 25, reviewsDue: 4 }))
    .toMatchObject({ daysLeft: 10, objectivesPerDay: 3 });
  expect(studyPlan({ today: '2026-11-10', examDate: '2026-11-10', objectivesRemaining: 2, reviewsDue: 0 })).toMatchObject({ daysLeft: 0, objectivesPerDay: 2 });
  expect(studyPlan({ today: '2026-11-10', examDate: '2026-11-01', objectivesRemaining: 2, reviewsDue: 0 })!.daysLeft).toBe(-9);
});
// API
'path: new learner sees domain 1 unlocked, domain 2 locked and hasContent false, objective flags false'
'path reflects lessonDone, quizPassed and mastery after activity'
'dashboard for a brand-new learner returns zeros, empty arrays, readiness.ready false, all badges unearned (no 500)'
'dashboard mockHistory only includes submitted mocks, newest last; readiness uses only non-partial mocks'
'dashboard ignores attempts whose question id no longer exists in content'
'practice returns only wrong-or-unseen questions with no answer data'
'settings: invalid time zone -> 400; examDate not YYYY-MM-DD -> 400; name over 64 chars -> 400; hideFromLeaderboard persists'
'dashboard never includes another learner's data (two users with different activity)'
```

  To support "non-partial mocks", store `partial` inside `assessments.breakdown` at finalize (Task 11's `finalize` already has it from `pickMock`; add the field there in this task if absent).

- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: mastery, readiness, path and dashboard`.

---

### Task 13: Leaderboard

**Files:**
- Create: `server/src/features/leaderboard/routes.ts`, `server/src/features/leaderboard/repo.ts`
- Test: `server/src/features/leaderboard/leaderboard.test.ts`

**Interfaces:**
- Consumes: `weekStartUtc`, `levelForXp`, `totals`.
- Route: `GET /api/leaderboard?period=week|all` → `{period, rows: [{rank, userId, name, level, xp, streak, isMe}], me: {rank, xp} | null}`. `rows` = top 50. `me` is the viewer's standing even when outside the top 50; `null` when the viewer is hidden or has no XP in the period.

Rules: `week` sums `xp_events` with `created_at >= weekStartUtc(now)`; `all` sums everything. Learners with 0 XP in the period are omitted. Order by XP descending, then by the time of the learner's latest XP event in the period ascending (who got there first), then `userId`. `level` is always from all-time XP. Excluded: `active = 0` and `hide_from_leaderboard = 1`. Admins who study appear like anyone else.

- [ ] **Step 1: Write the failing tests:**

```ts
'all-time ranks by total XP descending'
'week counts only events since Monday 00:00 UTC (an event at Sunday 23:59:59 UTC is excluded, Monday 00:00:00 included)'
'tie: the learner whose latest event is earlier ranks higher'
'hidden and deactivated learners are absent; a hidden viewer still gets rows and me === null'
'rows contain exactly the keys rank, userId, name, level, xp, streak, isMe (no login, role, scores)'
'viewer ranked 51st is not in rows but me.rank === 51'
'invalid period -> 400; anonymous -> 401'
```

- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3: Implement** with one aggregate query plus per-row streak for the returned rows.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: shared leaderboard`.

---

### Task 14: Labs API

**Files:**
- Create: `server/src/features/labs/routes.ts`, `server/src/features/labs/repo.ts`
- Test: `server/src/features/labs/labs.test.ts`

**Interfaces:**
- Consumes: `recordAnswer` (context `lab`), `toPublicQuestion`, `awardXp`, `unlockedDomains`.
- Routes: `GET /api/labs` → `{labs: [{id, domain, title, objectives, available, bestScore: number | null, passed}]}`; `GET /api/labs/:id` → `{id, title, scenario, steps: PublicQuestion[]}`; `POST /api/labs/:id/submit {answers: Record<stepId, Answer>}` → `{scorePct, passed, steps: Record<stepId, Feedback>, xp, newBadges}`.

Rules: a lab is `available` when its domain is unlocked and the learner has completed the lesson of every objective in `lab.objectives`. `scorePct` = mean of step `fraction` × 100 (partial credit, as on the real exam's PBQs). Pass at ≥ 80. `XP.labPass` once per lab. Missing step answers score 0.

- [ ] **Step 1: Write the failing tests:**

```ts
'list marks a lab unavailable until its objectives' lessons are complete; GET/submit on it return 403'
'GET returns steps with no answer data'
'all steps correct: 100, passed, 75 XP, lab_results row; resubmitting awards no more XP and bestScore stays 100'
'partial credit: fixture lab with 4 of 5 steps fully right and one order step half right scores 90'
'score 79.9 fails, 80 passes'
'missing step answers score 0 for that step; an answer keyed to an unknown step id is 400'
'third distinct passed lab returns lab-rat in newBadges'   // seed two prior lab_results rows
```

- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: scenario labs API`.

---

### Task 15: Client foundation — design system, shell, API client, auth screens

**Files:**
- Create: `client/src/styles.css`, `client/src/routes.tsx`, `client/src/api/client.ts`, `client/src/api/saveQueue.ts`, `client/src/ui/{Button,Card,ProgressRing,MasteryBar,Celebration,AppShell,ThemeToggle,SaveIndicator}.tsx`, `client/src/features/auth/{LoginPage,InvitePage,ResetPage,AuthProvider}.tsx`
- Modify: `client/src/App.tsx`, `client/src/main.tsx`, `vitest.config.ts` (jsdom project for `client/**`)
- Test: `client/src/api/saveQueue.test.ts`, `client/src/api/client.test.ts`, `client/src/features/auth/auth.test.tsx`, `client/src/ui/ui.test.tsx`

**Interfaces:**
- Produces (`api/client.ts`): `api.get<T>(path)`, `api.post<T>(path, body?)`, `api.put<T>(path, body)`, `api.patch<T>(path, body)`; all send `credentials: 'same-origin'` and `X-Requested-With: secplus`; non-2xx throws `ApiError { status; message }`; a `401` outside `/api/auth/*` redirects to `/login?next=<current path>`; a `503` or network failure throws `ApiError { status: 0 | 503 }`.
- Produces (`api/saveQueue.ts`):

```ts
export type SaveState = 'idle' | 'saving' | 'unsaved';
export function createSaveQueue(send: (item: { key: string; run: () => Promise<unknown> }) => Promise<unknown>, opts?: { delaysMs?: number[] }):
  { enqueue(key: string, run: () => Promise<unknown>): void; state(): SaveState; subscribe(fn: (s: SaveState) => void): () => void; flush(): Promise<void> };
```

  One pending item per `key` (a newer save for the same key replaces an unsent older one). Retries on `status` 0/503 with delays `[1000, 3000, 10000]` then every 10 s; any other error drops the item and reports it. `beforeunload` warns while state is not `idle`.
- Produces: `useAuth(): { user: User | null; login; logout; refresh }`; route guard `<RequireAuth>` and `<RequireAdmin>`.
- Produces (UI): `<ProgressRing value={0..100} size label />`, `<MasteryBar value label />`, `<Celebration kind="quiz-pass" | "level-up" | "badge" | "streak" title detail onDone />`, `<SaveIndicator />`, `<AppShell>` with nav (Path, Review, Labs, Exam, Dashboard, Leaderboard; Admin for admins), XP/level/streak in the header, theme toggle, and the CompTIA footer from Global Constraints.

Design tokens (CSS custom properties in `styles.css`, consumed through Tailwind's `@theme`): dark default `--bg #0a0f1a`, `--surface #121a2b`, `--border #22304a`, `--text #e6edf7`, `--muted #8fa3c2`, `--accent #2dd4bf`, `--ok #4ade80`, `--bad #f87171`, `--warn #fbbf24`; light theme under `[data-theme="light"]` with `--bg #f6f8fb`, `--surface #ffffff`, `--border #d5dde8`, `--text #0f172a`, `--muted #51627a`, `--accent #0f766e`, `--ok #15803d`, `--bad #b91c1c`, `--warn #b45309`. Fonts: system UI stack; `ui-monospace` for codes and timers. Theme choice persists in `localStorage` (`theme`), defaulting to the system preference. Wrap the app in `<MotionConfig reducedMotion="user">`; `Celebration` renders a static banner under reduced motion. Focus ring: 2px `--accent` outline with 2px offset on every focusable element.

- [ ] **Step 1: Write the failing tests:**

```ts
// saveQueue (fake timers)
'successful save: state saving -> idle'
'network failure: state becomes unsaved, retries after 1s, 3s, 10s, then every 10s, and reaches idle when a retry succeeds'
'a second enqueue for the same key while the first is unsent sends only the latest payload'
'two different keys are both sent, in order'
'a 400 response drops the item and does not retry'
'an item that failed then succeeded is sent exactly once successfully (no duplicate after success)'
// client
'adds X-Requested-With on every request'
'401 from /api/dashboard navigates to /login?next=%2Fdashboard; 401 from /api/auth/me does not'
// auth screens
'login form: submit calls api, on success navigates to next; on 401 shows "Invalid login or password"; on 429 shows a wait message'
'invite page: password under 12 chars shows inline error and does not submit; sends Intl time zone'
'invite page with 404/410 token shows "This link is no longer valid. Ask for a new one."'
// ui
'ProgressRing exposes role="progressbar" with aria-valuenow'
'AppShell shows Admin link only for admins and always shows the CompTIA footer'
'ThemeToggle sets data-theme on <html> and persists it'
```

- [ ] **Step 2:** Run `npx vitest run client`. Expected: FAIL.
- [ ] **Step 3: Implement.** Routes: `/login`, `/invite/:token`, `/reset/:token`, and guarded `/` (path), `/lesson/:objective`, `/quiz/:id`, `/exam`, `/exam/:id`, `/review`, `/labs`, `/labs/:id`, `/dashboard`, `/leaderboard`, `/settings`, `/admin` (placeholders until later tasks). A top-level error boundary shows "Can't reach the server" with a Retry button for `ApiError` status 0/503.
- [ ] **Step 4:** Run `npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Manual check.** `npm run dev`, set `ADMIN_*` in `.env`, log in as the admin at `http://localhost:5173`; toggle theme; tab through the login form and shell and confirm visible focus.
- [ ] **Step 6: Commit** `feat: client shell, design system and auth screens`.

---

### Task 16: Question components

**Files:**
- Create: `client/src/features/questions/{QuestionView,SingleChoice,MultiChoice,OrderQuestion,MatchQuestion,CategorizeQuestion,FeedbackPanel}.tsx`
- Test: `client/src/features/questions/questions.test.tsx`

**Interfaces:**
- Consumes: `PublicQuestion`, `Answer`, `Feedback`.
- Produces:

```ts
export function QuestionView(p: {
  question: PublicQuestion;
  value: Answer | null;                 // controlled
  onChange(a: Answer): void;
  feedback?: Feedback;                  // when present: locked, shows correct/wrong marking and FeedbackPanel
  disabled?: boolean;
}): JSX.Element;
export function isComplete(q: PublicQuestion, a: Answer | null): boolean;   // single: chosen; multi: >= 1; order: always; match/categorize: every item placed
```

Interaction: `single` = radio group; `multi` = checkboxes with "Choose N" hint only if the prompt states it; `order` = dnd-kit sortable list, plus per-item "Move up"/"Move down" buttons; `match` = each left item has a native `<select>` of right items alongside drag-to-pair; `categorize` = drag items into buckets, plus a per-item `<select>` of buckets. Initial `order` value is the served item order. With feedback, each option/item shows a ✓ or ✗ icon and text label (not color alone), and `why` text appears under each option.

- [ ] **Step 1: Write the failing tests:**

```ts
'single: clicking an option calls onChange({type:"single", choice})'
'single: arrow keys move selection within the radio group'
'multi: toggling builds choices; untoggling removes'
'order: "Move down" on the first item emits the swapped order; first item has no enabled "Move up"'
'order: keyboard drag (Space, ArrowDown, Space) emits the swapped order'
'match: choosing from the select emits pairs; choosing a right item already used moves it'
'categorize: select emits placements; isComplete false until every item is placed'
'with feedback: inputs are disabled, correct answer is marked, explanation and per-option why are shown, status announced via role="status"'
'isComplete for each type'
```

- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3: Implement.** Layout animations via Motion `layout`; a correct answer pulses `--ok`, a wrong one shakes once (both skipped under reduced motion).
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: question components for all five types`.

---

### Task 17: Path map, lesson player and Domain 1 diagrams

**Files:**
- Create: `client/src/features/path/PathPage.tsx`, `client/src/features/lesson/{LessonPage,SectionView,InlineCheck}.tsx`, `client/src/features/diagrams/{StepDiagram,registry}.tsx`, one file per diagram in `client/src/features/diagrams/` (`ControlTypesMatrix`, `CiaTriad`, `AaaFlow`, `ZeroTrustPlanes`, `ChangeManagementFlow`, `SymmetricVsAsymmetric`, `HashingSalting`, `PkiTrustChain`, `TlsHandshake`)
- Test: `client/src/features/path/path.test.tsx`, `client/src/features/lesson/lesson.test.tsx`, `client/src/features/diagrams/diagrams.test.tsx`

**Interfaces:**
- Consumes: `GET /api/path`, `GET /api/lessons/:objective`, `POST …/progress`, `POST /api/answers`, `QuestionView`, `Celebration`, `DIAGRAM_NAMES`.
- Produces:

```ts
export type DiagramStep = { title: string; description: string };
export function StepDiagram(p: { title: string; steps: DiagramStep[]; render(stepIndex: number): ReactNode /* SVG */ }): JSX.Element;
export const DIAGRAMS: Record<(typeof DIAGRAM_NAMES)[number], ComponentType>;
```

`StepDiagram`: Back / Next / Replay buttons, "Step n of N", the current step's description in an `aria-live="polite"` region, SVG marked `role="img"` with `aria-label` = step title. Each diagram supplies 4–8 steps of original explanatory text and animates only the elements that change between steps.

Diagram content (steps each must cover):
- `control-types-matrix`: a 4×6 grid of categories (technical, managerial, operational, physical) × types (preventive, deterrent, detective, corrective, compensating, directive); each step highlights a row or column with one concrete example per cell.
- `cia-triad`: confidentiality, integrity, availability, then one attack and one control per corner.
- `aaa-flow`: identify → authenticate → authorize → account, for a person and for a device.
- `zero-trust-planes`: subject → policy enforcement point → resource; policy engine and policy administrator in the control plane; adaptive identity, threat scope reduction; implicit trust zone.
- `change-management-flow`: request → impact analysis → approval → test → maintenance window → implement → verify or back out → update documentation.
- `symmetric-vs-asymmetric`: one shared key vs a key pair; key-exchange problem; hybrid use.
- `hashing-salting`: hash is one-way; same input same hash; rainbow table; salt; key stretching.
- `pki-trust-chain`: root CA → intermediate → leaf; CSR; validation walk; CRL and OCSP; self-signed.
- `tls-handshake`: hello and cipher choice; certificate; key exchange; session keys; encrypted data.

Lesson player: one section at a time with a progress bar; Next is disabled until every inline check in the section has been answered (right or wrong); finishing a section posts progress; finishing the last shows `Celebration` and a "Take the quiz" button that creates an `objective` assessment and navigates to `/quiz/:id`. Path page: five domain cards in a vertical trail, each objective a node showing lesson done / quiz passed / mastery ring; locked domains show a lock and "Pass the Domain N−1 exam to unlock"; domains with `hasContent: false` show "Coming soon"; each unlocked domain has a "Domain exam" button.

- [ ] **Step 1: Write the failing tests:**

```ts
'path: locked domain nodes are not links and state how to unlock; hasContent false shows "Coming soon"'
'path: completed objective shows both checkmarks with accessible labels'
'lesson: Next disabled until the inline check is answered, then enabled; posts progress on Next'
'lesson: resumes at the first section not in sectionsDone'
'lesson: last section shows Celebration and "Take the quiz"'
'lesson: unknown diagram name renders a visible "Diagram unavailable" note, not a crash'
'every name in DIAGRAM_NAMES has a registered component that renders, has 4–8 steps, and Next/Back update "Step n of N" and the live description'
```

- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3: Implement.** Lesson HTML is inserted with `dangerouslySetInnerHTML` (it comes only from repo files via the server parser).
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: learning path, lesson player and Domain 1 diagrams`.

---

### Task 18: Assessment screens

**Files:**
- Create: `client/src/features/assessment/{QuizPage,ExamLobbyPage,ExamPage,ExamTimer,QuestionNavigator,ResultsView}.tsx`
- Test: `client/src/features/assessment/assessment.test.tsx`

**Interfaces:**
- Consumes: assessments API, `QuestionView`, `isComplete`, `createSaveQueue`, `SaveIndicator`, `Celebration`.
- Produces: `QuizPage` (route `/quiz/:id`, kind `objective`), `ExamLobbyPage` (`/exam`), `ExamPage` (`/exam/:id`, kinds `domain` and `mock`), `<ResultsView result questions answers feedback />`.

Behavior:
- Quiz: one question at a time; "Check" sends the answer and shows feedback; "Next"; results at the end with pass/fail against 80%, and "Retake" or "Back to path".
- Exam lobby: explains the rules (count, minutes, no feedback until the end, 750 to pass); shows "Partial practice exam — covers Domain 1 only" when applicable; "Start" or "Resume" if one is open; history list.
- Exam: answers save through the save queue keyed by question id on every change; navigator grid shows answered / unanswered / flagged with text labels; "Flag for review" toggle; timer counts down from `deadlineAt` using the server-provided time, turns `--warn` under 5 minutes and announces "5 minutes remaining" and "1 minute remaining" once each; at zero it flushes the queue and submits; "Submit" opens a confirmation dialog listing the number unanswered and flagged; submitting waits for the save queue to flush. Reloading the page restores answers and flags from `GET`.
- Results: animated score ring, scaled score for mocks, pass/fail, per-domain and per-objective bars, and a review list of every question with the learner's answer and feedback, filterable to "Missed only".

- [ ] **Step 1: Write the failing tests:**

```ts
'quiz: Check is disabled until isComplete; shows feedback then Next; last question leads to results'
'quiz results: 8/10 shows Passed, 7/10 shows "Not yet" with Retake'
'exam: selecting an answer enqueues a PUT; navigator marks it answered'
'exam: flag toggles and shows in the navigator'
'exam: reload restores answers and flags from the API'
'exam: timer shows mm:ss from deadlineAt, announces at 5:00 and 1:00 once each, and auto-submits at 0 after flushing saves'
'exam: submit dialog states "3 unanswered, 1 flagged" and submits only on confirm'
'exam: while saves are failing the SaveIndicator reads "Not saved yet" and Submit waits for flush'
'exam: a 409 on save (deadline passed) loads the finalized results'
'results: "Missed only" filter hides correct items; mock shows scaled score, domain exam shows percent'
'lobby shows the partial-exam notice when the last assessment or API marks partial'
```

- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: quiz, domain exam and mock exam screens`.

---

### Task 19: Review and labs screens

**Files:**
- Create: `client/src/features/review/{ReviewPage,FlashcardView}.tsx`, `client/src/features/labs/{LabsPage,LabPage}.tsx`
- Test: `client/src/features/review/review.test.tsx`, `client/src/features/labs/labs.test.tsx`

**Interfaces:**
- Consumes: review API, labs API, `QuestionView`, `Celebration`.

Behavior:
- Review: works through due cards one at a time. Question cards use `QuestionView` with Check → feedback → Next. Flashcards show the term, a "Show answer" button (Space or Enter) that flips the card (3D flip; cross-fade under reduced motion), then "I knew it" / "I didn't" (keys `1` / `2`). End screen: cards reviewed, how many moved up, next due date. Empty state: "Nothing due today. Next review: <date>." with a link to the path.
- Labs list: cards by domain with best score; unavailable labs state which lessons to finish.
- Lab: scenario text pinned at the top, all steps on one page each as a `QuestionView`, "Submit lab" enabled when every step `isComplete`; results show score, pass at 80%, per-step feedback, "Try again".

- [ ] **Step 1: Write the failing tests:**

```ts
'review: empty state when total is 0'
'review: flashcard hides the definition until Show answer; "I knew it" posts knewIt true and advances'
'review: keyboard — Space reveals, 1 and 2 grade'
'review: question card posts the answer and shows feedback before Next'
'review: end screen summarizes counts'
'labs list: unavailable lab is not a link and names the lessons required'
'lab: Submit disabled until all steps complete; results show per-step feedback and Passed at >= 80'
```

- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: review and lab screens`.

---

### Task 20: Dashboard, leaderboard, settings and admin screens

**Files:**
- Create: `client/src/features/dashboard/{DashboardPage,ReadinessCard,MockHistoryChart,BadgeGrid,PracticePage}.tsx`, `client/src/features/leaderboard/LeaderboardPage.tsx`, `client/src/features/settings/SettingsPage.tsx`, `client/src/features/admin/AdminPage.tsx`, `client/src/features/rewards/RewardsProvider.tsx`
- Modify: `client/src/routes.tsx` (add `/practice/:objective`), `client/src/ui/AppShell.tsx`
- Test: one `*.test.tsx` beside each page

**Interfaces:**
- Consumes: dashboard, practice, leaderboard, settings and admin APIs.
- Produces: `useRewards(): { report(r: { xp?: number; newBadges?: string[] }): void }` — every screen that receives `xp`/`newBadges` from the API calls `report`; the provider updates the header XP, and queues `Celebration` for a level-up or new badge (one at a time).

Behavior:
- Dashboard: readiness card (Ready / Not yet, with the `missing` list), study-plan line when an exam date is set, reviews due with a button, domain mastery bars, weakest objectives each with "Practice now" (→ `/practice/:objective`, which runs the returned questions through `QuestionView` + `POST /api/answers`), mock history as an SVG line chart with a dashed line at 750 and a data table alternative, badge grid (earned in color, unearned dimmed with how to earn).
- Leaderboard: "This week" / "All time" tabs; rows animate position with Motion `layout`; top three get medal icons with text alternatives; the viewer's row is highlighted, and when outside the top 50 a pinned row shows their rank; hidden viewers see a note with a link to settings; empty state "No XP yet this week — be the first."
- Settings: display name, time zone (select of `Intl.supportedValuesOf('timeZone')`), exam date, "Hide me from the leaderboard", theme.
- Admin: learner table (name, login, last active, domains passed, latest mock, active); "Create invite link" and per-learner "Password reset link" show the full URL (`location.origin + url`) with a Copy button and the expiry date; activate/deactivate with a confirmation dialog.

- [ ] **Step 1: Write the failing tests:**

```ts
'dashboard: new learner renders with zeros and "Not yet" plus each missing reason'
'dashboard: study plan line appears only with an exam date; a past date shows "Your exam date has passed — update it in Settings"'
'dashboard: chart has a table alternative listing each mock score'
'practice: runs through returned questions and reports XP; empty list shows "Nothing to practice here — mastery is 100%"'
'leaderboard: switching tabs refetches with period; viewer row has aria-current; pinned row when me.rank > rows.length'
'leaderboard: hidden viewer note; empty state'
'settings: saving sends only changed fields; server 400 message is shown next to the field'
'admin: invite link shows full URL and copies to clipboard; deactivate asks for confirmation'
'rewards: report with XP crossing a level boundary queues a level-up Celebration; two badges show one after another'
```

- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3: Implement.** Wire `useRewards().report` into the lesson, quiz, exam, review, lab and practice screens.
- [ ] **Step 4:** Run `npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: dashboard, leaderboard, settings and admin screens`.

---

### Content authoring rules (Tasks 21–25)

Apply to every content task:

- Audience has help-desk / A+ / Network+ level experience. Do not explain what an IP address or a file is; do explain every security term on first use.
- Cover every bullet under the objective in CompTIA's SY0-701 objectives document, using its exact terms so learners recognize them on the exam. Read the official document before writing; the topic lists below are a checklist, not a replacement for it.
- Lesson: 5–9 sections, 10–20 minutes, at least one `:::diagram` where listed, one `:::check` per section, at least two "Exam tip" and one "Common trap" callouts. Short paragraphs, concrete workplace examples, comparison tables for look-alike terms.
- Questions: scenario-based where the objective says "given a scenario"; four options for `single`; five or six for `multi` with the number to choose stated in the prompt; plausible distractors drawn from neighboring terms; `why` explains each option in one or two sentences; `explanation` states the rule to remember. Mix per objective: about 65% `single`, 15% `multi`, 20% PBQ types (`order`, `match`, `categorize`); difficulty about 30% / 50% / 20% for levels 1 / 2 / 3. No "all of the above", no negatively worded stems without **NOT** in bold, no trick wording.
- Flashcards: one per term or acronym in the objective; definition under 30 words.
- Ids: `q-<objective>-NNN`, `f-<objective>-NNN`, zero-padded, sequential.
- Each task ends by setting the objective's `published: true` in `content/manifest.json`.

Each content task has the same steps:

- [ ] **Step 1:** Write `content/domains/1/<objective>/lesson.md`.
- [ ] **Step 2:** Write `content/domains/1/<objective>/questions.json` meeting the minimum count.
- [ ] **Step 3:** Append the objective's flashcards to `content/flashcards.json`.
- [ ] **Step 4:** Set `published: true`; run `npm run check-content && npm test`. Expected: `Content OK` with the new totals; tests PASS.
- [ ] **Step 5:** Self-review against the official objective: tick off every bullet as covered by the lesson and by at least one question; re-read every question's keyed answer and confirm it is unambiguously the best option.
- [ ] **Step 6:** Run `npm run dev` and read the lesson end to end in the browser, answering each check.
- [ ] **Step 7: Commit** `content: objective <id>`.

### Task 21: Content — objective 1.1 (security controls)

**Files:** Create `content/domains/1/1.1/lesson.md`, `content/domains/1/1.1/questions.json`; modify `content/flashcards.json`, `content/manifest.json`.

Minimum 20 questions, 12 flashcards. Diagram: `control-types-matrix`. Topics: control categories (technical, managerial, operational, physical); control types (preventive, deterrent, detective, corrective, compensating, directive); classifying one control by both category and type; when a compensating control is appropriate. Include at least two `categorize` questions sorting example controls by type and by category.

### Task 22: Content — objective 1.2 (fundamental security concepts)

**Files:** Create `content/domains/1/1.2/lesson.md`, `content/domains/1/1.2/questions.json`; modify `content/flashcards.json`, `content/manifest.json`.

Minimum 25 questions, 30 flashcards. Diagrams: `cia-triad`, `aaa-flow`, `zero-trust-planes`. Topics: confidentiality, integrity, availability; non-repudiation; authentication, authorization and accounting (authenticating people, authenticating systems, authorization models); gap analysis; zero trust — control plane (adaptive identity, threat scope reduction, policy-driven access control, policy administrator, policy engine) and data plane (implicit trust zones, subject/system, policy enforcement point); physical security (bollards, access control vestibule, fencing, video surveillance, security guard, access badge, lighting, sensors: infrared, pressure, microwave, ultrasonic); deception and disruption technology (honeypot, honeynet, honeyfile, honeytoken). Include a `match` question pairing zero-trust components with roles and an `order` question for the AAA sequence.

### Task 23: Content — objective 1.3 (change management)

**Files:** Create `content/domains/1/1.3/lesson.md`, `content/domains/1/1.3/questions.json`; modify `content/flashcards.json`, `content/manifest.json`.

Minimum 20 questions, 15 flashcards. Diagram: `change-management-flow`. Topics: business processes (approval process, ownership, stakeholders, impact analysis, test results, backout plan, maintenance window, standard operating procedure); technical implications (allow lists/deny lists, restricted activities, downtime, service restart, application restart, legacy applications, dependencies); documentation (updating diagrams, updating policies/procedures); version control. Include an `order` question for the steps of a change.

### Task 24: Content — objective 1.4 (cryptographic solutions)

**Files:** Create `content/domains/1/1.4/lesson.md`, `content/domains/1/1.4/questions.json`; modify `content/flashcards.json`, `content/manifest.json`.

Minimum 30 questions, 35 flashcards. Diagrams: `symmetric-vs-asymmetric`, `hashing-salting`, `pki-trust-chain`, `tls-handshake`. Topics: PKI (public key, private key, key escrow); encryption levels (full-disk, partition, file, volume, database, record); transport/communication encryption; asymmetric and symmetric encryption; key exchange; algorithms; key length; tools (TPM, HSM, key management system, secure enclave); obfuscation (steganography, tokenization, data masking); hashing; salting; digital signatures; key stretching; blockchain; open public ledger; certificates (certificate authorities, CRLs, OCSP, self-signed, third-party, root of trust, CSR generation, wildcard). Include a table of common algorithms by family (symmetric, asymmetric, hash) with a matching `categorize` question, and an `order` question for obtaining a certificate.

### Task 25: Content — Domain 1 labs

**Files:** Create `content/labs/lab-1-01.json`, `lab-1-02.json`, `lab-1-03.json`.

Each lab: an original scenario of 80–150 words about a fictional organization, 4–6 steps using at least two PBQ types, every step with a full explanation.

- `lab-1-01` "Classify the controls" (objectives `1.1`): a small clinic's security review; sort ten controls by category, sort the same by type, pick compensating controls for a legacy device.
- `lab-1-02` "Plan the firewall change" (objectives `1.3`, `1.2`): order the change steps, match stakeholders to responsibilities, choose the backout trigger, pick the documentation to update.
- `lab-1-03` "Secure the new web portal" (objectives `1.4`): order the certificate request and issuance steps, match requirements to cryptographic tools (TPM, HSM, hashing with salt, tokenization, full-disk encryption), categorize algorithms, pick the right certificate type.

- [ ] **Step 1:** Write the three lab files.
- [ ] **Step 2:** Run `npm run check-content && npm test`. Expected: `Content OK: … 3 labs …`; PASS.
- [ ] **Step 3:** Play each lab in the browser once with all-correct answers (expect 100%) and once with deliberate mistakes (expect partial credit and feedback on each wrong step).
- [ ] **Step 4: Commit** `content: Domain 1 labs`.

---

### Task 26: End-to-end verification, README and release

**Files:**
- Create: `README.md`
- Modify: anything the walkthrough shows to be broken

- [ ] **Step 1: Automated gate.** Run `npm run typecheck && npm test && npm run check-content && npm run build`. Expected: all pass; `Content OK` reports at least 95 questions, 4 lessons, 3 labs, 92 flashcards.
- [ ] **Step 2: Production-mode smoke test.** `NODE_ENV=production PORT=3999 npm start`, open `http://localhost:3999`. Confirm in the browser's network panel that no `/api` response before answering contains `"correct"`, `"explanation"` or `"why"`; confirm the CSP header is present and the console shows no CSP violations.
- [ ] **Step 3: Walkthrough as a new learner** at desktop width and at 375px: admin creates an invite → accept it → path → lesson 1.1 with diagram and checks → objective quiz → review a missed card → lab → domain exam → partial practice exam (let one run out the clock with the tab closed, reopen, confirm it was finalized) → dashboard → leaderboard with two learners → settings (hide from leaderboard, exam date) → log out. Repeat the lesson and one exam using only the keyboard. Repeat one lesson with the OS "reduce motion" setting on. Fix what fails, with a test for each fix.
- [ ] **Step 4: Write `README.md`:** what the site is, the CompTIA non-affiliation notice, local setup (Node, MySQL, `.env`, `npm run dev`), the scripts, how to add content (file formats, id rules, `check-content`), and Hostinger settings: build command `npm run build`, start command `npm start`, Node version 20 or later, environment variables `DATABASE_URL`, `NODE_ENV=production`, `ADMIN_LOGIN`, `ADMIN_PASSWORD`, `ADMIN_NAME` (and a note to remove `ADMIN_PASSWORD` after first start).
- [ ] **Step 5: Commit** `docs: README and release checklist`.
- [ ] **Step 6: Stop and ask the owner** before any of the following, since each is outward-facing: create the MySQL database on Hostinger and set the environment variables; push `phase-1`; merge to `main` (which triggers the Hostinger deploy to `sec.networkitout.com`). After deploy, verify `/api/health`, log in as admin, and create the first invite.
