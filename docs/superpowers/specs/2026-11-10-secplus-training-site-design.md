# Security+ Training Site — Design Spec

Date: 2026-11-10
Status: awaiting review

## 1. Purpose

An interactive website that takes a learner from "some IT experience" to
passing the CompTIA Security+ exam (SY0-701). It is the learner's main
study resource: it teaches every exam objective, tests knowledge
continuously, and tells the learner when they are ready to book the exam.

### What the owner asked for

- Interactive training site for Security+.
- Visually engaging and animated.
- Tests knowledge as progress is made.
- Hosted on Hostinger's web app plan (can run server code).
- Any other improvements that help a learner succeed.

### Decisions made during brainstorming

- Audience: a small private group, invited by the owner. No public sign-up.
- Role: main study resource, covering all objectives in full.
- Learner level: some IT experience (help desk, A+/Network+ level).
  Lessons do not teach basic computing or networking from scratch.

### Assumptions (correct these if wrong)

- Target exam is SY0-701, English only.
- All lessons, questions and labs are original content written for this
  site. No real exam questions or third-party material are copied.
- Group size is under about 50 learners.
- The site carries a notice that it is not affiliated with or endorsed by
  CompTIA.

### Success criteria

- Every one of the 28 SY0-701 objectives has a lesson, a quiz and review
  cards.
- A learner can sign in on any device and see the same progress.
- A learner can sit a timed mock exam that matches the real exam's length
  and domain weighting.
- The dashboard shows mastery per domain and objective and a clear
  ready / not-ready signal.
- The site is usable for study as soon as Domain 1 is complete.

## 2. Out of scope

- Public registration, email sending, payments.
- Video or audio lessons.
- An AI tutor or chat.
- Native mobile apps (the site is responsive instead).
- A browser-based content editor (content is edited as files in the repo).

## 3. Exam facts the design relies on

| Domain | Title | Weight | Objectives |
|---|---|---|---|
| 1 | General Security Concepts | 12% | 1.1–1.4 |
| 2 | Threats, Vulnerabilities, and Mitigations | 22% | 2.1–2.5 |
| 3 | Security Architecture | 18% | 3.1–3.4 |
| 4 | Security Operations | 28% | 4.1–4.9 |
| 5 | Security Program Management and Oversight | 20% | 5.1–5.6 |

- Up to 90 questions in 90 minutes, multiple choice plus
  performance-based questions (PBQs).
- Scored 100–900; 750 passes.

These must be re-checked against CompTIA's published objectives document
before content writing starts.

## 4. Architecture

One deployable Node.js application.

- **Client:** React + TypeScript single-page app built with Vite. Tailwind
  CSS for styling, Motion (Framer Motion) for animation, React Router for
  navigation.
- **Server:** Express + TypeScript. Serves the built client and a JSON API
  under `/api`.
- **Database:** MySQL (Hostinger-provided), accessed with `mysql2` and
  parameterized queries. Plain SQL migration files run by a small script.
- **Content:** files in the repo, loaded and validated at server start.
- **Tests:** Vitest for unit tests, Supertest for API tests.

Hostinger runs `npm run build` then `npm start`. Configuration (database
credentials, session secret) comes from environment variables.

### Repository layout

```
client/          React app
  src/features/  one folder per feature (lesson, quiz, review, labs, exam, dashboard, admin, auth)
  src/ui/        shared components and animation primitives
server/
  src/routes/    one router per feature
  src/services/  scoring, review scheduling, mastery, exam assembly
  src/content/   loader + schema validation
  src/db/        connection, migrations
content/
  domains/<n>/<objective>/lesson.md
  domains/<n>/<objective>/questions.json
  labs/<id>.json
  flashcards.json
docs/
```

### Unit boundaries

| Unit | Responsibility | Depends on |
|---|---|---|
| Content loader | Read and validate content files; expose lookups | filesystem |
| Scoring service | Grade any question type; pure functions | content |
| Review scheduler | Decide when a card is next due; pure functions | — |
| Mastery service | Compute mastery and readiness from attempts | database |
| Exam assembler | Draw a weighted question set for a mock exam | content |
| Auth | Sessions, invites, password hashing | database |
| API routers | HTTP only; delegate to services | services |
| Client features | Screens; talk to the API through one typed client | API |

The scoring, scheduling and exam-assembly services are pure and tested
without a database.

## 5. Content model

### Lessons

Markdown with front matter (objective id, title, estimated minutes).
A lesson is split into sections. A section may contain:

- prose, tables and callouts ("Exam tip", "Common trap");
- a named interactive diagram, e.g. `:::diagram tls-handshake`;
- an inline check question, by question id.

Interactive diagrams are React components registered by name. The initial
set: CIA triad, AAA flow, symmetric vs asymmetric encryption, TLS
handshake, PKI trust chain, hashing and salting, zero-trust control and
data planes, cyber kill chain, common attack flows (phishing, on-path,
SQL injection), network zones and firewall placement, incident-response
lifecycle, risk matrix, backup types. Each has step-through controls and
a text description.

### Questions

JSON, each with: id, objective id, type, prompt, options, correct answer,
an explanation of why the answer is right **and why each distractor is
wrong**, and a difficulty (1–3).

Types:

- `single` — one correct option.
- `multi` — choose N.
- `order` — put steps in sequence.
- `match` — pair items between two lists.
- `categorize` — drag items into buckets.

The last three are the PBQ-style types. Larger scenario labs
(`content/labs`) combine several of them around one scenario, such as
building a firewall rule set or triaging log entries.

### Flashcards

Term and definition, tagged by objective: acronyms, ports and protocols,
cryptographic algorithms, attack names, control types.

### Volume targets

- 28 lessons, one per objective.
- At least 20 questions per objective, more for heavier domains: at least
  600 in total.
- At least 15 scenario labs.
- At least 300 flashcards.

A content check (run in tests and at build) fails if any objective lacks
a lesson, falls below its question minimum, references a missing diagram
or question id, or has a question without an explanation.

## 6. Learner features

### Path

Home shows the five domains as a visual map with each objective as a
node. Each objective has: lesson → objective quiz (10 questions, 80% to
complete). Each domain ends with a domain exam (25 questions, 75% to
pass). Passing a domain exam unlocks the next domain. A learner may take
a domain exam at any time, so experienced learners can test out.

### Feedback

Lesson checks, quizzes and review give immediate feedback with the
explanation. Domain exams and mock exams give feedback only at the end,
like the real exam.

### Review (spaced repetition)

Every missed question and every flashcard the learner has seen becomes a
review card in a five-box Leitner system with intervals of 1, 2, 4, 8 and
16 days. Correct moves a card up a box; wrong sends it to box 1. The home
screen shows how many cards are due today.

### Labs

Scenario labs listed by domain, playable any time after the related
objective is complete. All drag-and-drop interactions also work by
keyboard and touch.

### Mock exam

- 90 items in 90 minutes: 11 / 20 / 16 / 25 / 18 across domains 1–5,
  including three PBQ-style items placed first.
- Flag-for-review, question navigator, visible timer, auto-submit at
  zero. An exam in progress survives a page reload.
- Result: estimated scaled score `100 + 800 × fraction correct`, pass at
  750, breakdown by domain and objective, and a review of every item.
- The score is labeled an estimate, because CompTIA does not publish its
  scaling.
- Questions seen least recently are preferred, to limit memorization.
- Until all five domains have content, this mode is labeled "partial
  practice exam" and draws only from available domains.

### Dashboard

- Mastery per objective: share of that objective's questions whose most
  recent attempt was correct.
- Mastery per domain: weighted average of its objectives.
- Weakest five objectives with a "practice now" button.
- Mock exam history chart.
- **Readiness:** "Ready" when the average of the last three mock exams is
  800 or higher and every domain's mastery is 80% or higher. Otherwise
  the dashboard states what is missing.

### Motivation

- XP for lessons, correct answers and reviews; levels.
- Daily streak (any study activity on a calendar day in the learner's
  time zone).
- Badges for milestones (first domain, 7-day streak, first passing mock,
  and similar).
- Optional exam date: the site then shows days remaining and a suggested
  daily workload (new objectives plus reviews) to finish in time.

### Leaderboard

One leaderboard shared by every learner on the site, stored on the server
so it is the same for everyone on every device.

- Two tabs: **This week** (XP earned since Monday 00:00 UTC) and
  **All time** (total XP).
- Each row shows rank, display name, level, XP and current streak. The
  viewer's own row is highlighted and always visible, even when outside
  the top rows. Rank changes animate.
- Ties are broken by who reached the XP total first.
- Only XP, level and streak are shared. Quiz scores, mock exam scores,
  mastery and readiness stay private to the learner and the admin.
- XP is awarded only by the server when it grades an answer or records a
  completed lesson, so it cannot be inflated from the browser. A question
  earns full XP the first time it is answered correctly and a small
  amount for later review, so repeating easy questions does not win.
- A learner can turn on "hide me from the leaderboard" in settings; they
  still earn XP and see the board.
- Deactivated learners are removed from the board.

## 7. Accounts and admin

- The first admin is created automatically at server start, from
  environment variables, when no admin exists yet. (Hostinger offers no
  convenient way to run a one-off command.)
- Database migrations also run automatically at server start.
- Admin creates single-use invite links that expire after 7 days. The
  invitee picks a display name and password (minimum 12 characters).
- No email is sent. For a forgotten password, the admin generates a
  single-use reset link and passes it on.
- Admin page: list learners with last-active date, domains passed and
  latest mock score; deactivate a learner; create invite and reset links.
- Learners see only their own data, plus the leaderboard fields of other
  learners (display name, level, XP, streak).

## 8. Data model

| Table | Holds |
|---|---|
| `users` | id, display name, login name, password hash, role, time zone, exam date, active flag, hide-from-leaderboard flag |
| `invites` | token hash, purpose (invite or reset), user id if reset, expiry, used-at |
| `sessions` | session id hash, user id, expiry |
| `lesson_progress` | user, objective, sections completed, completed-at |
| `attempts` | user, question id, correct, context (lesson, quiz, review, exam), timestamp |
| `review_cards` | user, card id (question or flashcard), box, due date |
| `assessments` | user, kind (objective quiz, domain exam, mock exam), scope, question list, answers so far, started-at, deadline, submitted-at, score, passed, per-domain breakdown |
| `lab_results` | user, lab id, score, passed, timestamp |
| `xp_events` | user, amount, reason, timestamp |
| `badges` | user, badge id, earned-at |

Content is not stored in the database. Attempts refer to content ids, so
ids are never reused or renamed once published.

## 9. API outline

- `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- `POST /api/auth/accept-invite`, `POST /api/auth/reset`
- `GET /api/path` — domains, objectives and the learner's status for each
- `GET /api/lessons/:objective`, `POST /api/lessons/:objective/progress`
- `POST /api/answers` — grade one question, record attempt, update review card, return explanation
- `GET /api/review/due`, `POST /api/review/:card`
- `GET /api/labs`, `GET /api/labs/:id`, `POST /api/labs/:id/submit`
- `POST /api/assessments`, `GET /api/assessments/:id`, `PUT /api/assessments/:id/answers`, `POST /api/assessments/:id/submit` — objective quizzes, domain exams and mock exams share one resource, distinguished by `kind`
- `GET /api/dashboard`
- `GET /api/leaderboard?period=week|all`
- `PUT /api/settings` — time zone, exam date, leaderboard visibility
- `GET/POST /api/admin/users`, `POST /api/admin/invites`

All grading happens on the server. Correct answers and explanations are
never sent to the client before an answer is submitted.

## 10. Visual design

- Dark "security operations center" theme by default with a light
  alternative; one accent color plus semantic colors for correct, wrong
  and warning.
- Motion: page and section transitions, animated progress rings and
  mastery bars, step-through diagrams, drag-and-drop with spring physics,
  celebratory moments for passed quizzes, level-ups and streaks.
- Honors the system "reduce motion" setting: animations become instant
  state changes and diagrams remain usable step by step.
- Responsive from 360px wide. Meets WCAG 2.2 AA for contrast, focus
  visibility and keyboard operation.

## 11. Security

It is a security training site, so it should model good practice.

- Passwords hashed with bcrypt (`bcryptjs`, no native build needed).
- Session cookie: `HttpOnly`, `Secure`, `SameSite=Lax`; session ids and
  invite tokens stored hashed.
- State-changing requests require a custom header, rejecting cross-site
  form posts.
- Login rate limiting per account and per IP address.
- Security headers via Helmet, including a content security policy with
  no inline scripts.
- Input validated with Zod on every route; parameterized SQL only.
- Markdown rendered from repo files only, never from user input.
- No secrets in the repo; `.env.example` documents required variables.

## 12. Error handling

- Invalid content stops the build and server start with a message naming
  the file and field.
- If saving an answer fails, the client keeps it, shows a "not saved yet"
  indicator and retries. Mock exam answers are saved after every
  question.
- Expired sessions redirect to login and return the learner to where they
  were.
- If the database is unreachable, the API returns 503 and the client
  shows a retry screen.
- A mock exam whose time expired while the learner was offline is
  submitted on the server with the answers saved so far.

## 13. Testing

- Unit: scoring for every question type, Leitner scheduling, mastery and
  readiness calculation, exam assembly (counts per domain, no
  duplicates), streak calculation across time zones.
- API: authentication and invite flows, authorization (a learner cannot
  read another learner's data; non-admins cannot reach admin routes;
  the leaderboard returns only the shared fields and omits hidden and
  deactivated learners),
  answer leakage (no correct answers in pre-submission responses), full
  exam lifecycle.
- Content: the content check described in section 5.
- Client: component tests for each question type, including keyboard
  operation.
- Manual: a walkthrough in a browser at phone and desktop widths before
  each phase is called done.

## 14. Delivery phases

Each phase ends with a working, deployable site.

1. **Platform + Domain 1.** Accounts, admin, path, lessons, all question
   types, quizzes, review, dashboard, motivation, visual design. Domain 1
   content complete. Partial practice exam.
2. **Domain 2** content and its diagrams and labs.
3. **Domain 3** content.
4. **Domain 4** content.
5. **Domain 5** content; full mock exam and readiness signal switched on.
6. **Deploy to Hostinger** and invite learners. May happen earlier, after
   any phase, once the Hostinger connection is authorized.

The implementation plan that follows this spec covers phase 1. Phases
2–5 are content work that reuses the phase 1 platform and gets its own
plan.

## 15. Hosting and prerequisites

- The site is served at `sec.networkitout.com`.
- Hostinger deploys from the GitHub repository, which is public. Secrets
  live only in Hostinger environment variables; `.env` is git-ignored and
  nothing secret is ever committed. Because the repo is public, the
  question bank and its answers are readable by anyone; server-side
  grading keeps progress honest but does not keep answers confidential.
- Node.js 20 or later must be installed on the development machine; it is
  not currently on the shell's path.
- A MySQL database must be created on the Hostinger plan.
- Someone should spot-check lesson content against the official SY0-701
  objectives document as each domain is completed.
