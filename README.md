# SecPlus Trainer

A study site for the CompTIA Security+ exam (SY0-701), for a small group of invited learners. A learner
reads a lesson for each exam objective, answers check questions inside it, passes a 10-question quiz per
objective and a 25-question exam per domain, plays scenario labs, reviews missed questions and flashcards
on a spaced schedule, and sits timed practice exams. A dashboard shows mastery per domain and objective,
and a leaderboard shows XP, level and streak.

Phase 1 holds the whole platform and the content of Domain 1 (objectives 1.1 to 1.4): 4 lessons, 132
questions, 3 labs and 135 flashcards. Domains 2 to 5 are listed as "Coming soon". Until they have content,
the practice exam is a partial one: 11 questions in 11 minutes.

Not affiliated with or endorsed by CompTIA. Security+ is a trademark of CompTIA, Inc.

All lessons, questions, labs and flashcards are original. No real exam questions are included.

## Contents

- [Requirements](#requirements)
- [Local setup](#local-setup)
- [npm scripts](#npm-scripts)
- [Project layout](#project-layout)
- [Database migrations](#database-migrations)
- [Adding content](#adding-content)
- [Accounts: invites and password resets](#accounts-invites-and-password-resets)
- [Security notes for the operator](#security-notes-for-the-operator)
- [Deploying to Hostinger](#deploying-to-hostinger)
- [Release checklist](#release-checklist)

## Requirements

- **Node.js.** To build and run the site: 20.19 or later in the 20 line, or 22.12 or later. This is the
  range `package.json` declares (`"node": "^20.19.0 || >=22.12.0"`), and it is what Vite, which builds
  the client, accepts; Node 21 is outside it. To work on the code (`npm run dev`, `npm test`): 22.12 or
  later, because the test runner and the dev process runner need it.
- **MySQL 8** or later. Development used the Homebrew MySQL server.
- npm, which comes with Node.

## Local setup

1. **Install the packages.**

   ```sh
   npm install
   ```

2. **Create two databases**: one for development and one that the tests may empty. The names are yours
   to choose.

   ```sql
   CREATE DATABASE secplus_dev CHARACTER SET utf8mb4;
   CREATE DATABASE secplus_test CHARACTER SET utf8mb4;
   ```

   The MySQL user in the URLs below needs the right to create tables in them: the server creates and
   updates its tables itself when it starts.

3. **Create `.env`** in the repository root from `.env.example`, and fill it in. `.env` is ignored by
   git. Never commit it.

   | Variable | Needed | Meaning |
   | --- | --- | --- |
   | `DATABASE_URL` | always | `mysql://USER:PASSWORD@HOST:PORT/DATABASE`. The port may be left out (3306). Percent-encode any character in the user name or password that has a meaning in a URL (`@`, `:`, `/`, `#`, `?`, `%`). The server does not start without it. |
   | `TEST_DATABASE_URL` | for `npm test` | Same form, for the test database. It must not be the same as `DATABASE_URL`: the tests empty every table of this database, and refuse to run if the two are equal. |
   | `PORT` | no | Port of the server. Default 3000. |
   | `NODE_ENV` | no | Leave it empty in `.env`. The server runs in production mode unless `NODE_ENV` is exactly `development` or `test`: unset, empty or any other value means production. `npm run dev` sets `development` itself. See [Production mode](#production-mode-and-development-mode). |
   | `TRUST_PROXY` | no | How many reverse proxies stand between the internet and the app: a whole number, 0 or more. Unset, it is 1 in production mode and 0 in development mode. Anything that is not a whole number stops the server at start. See [The proxy in front of the app](#the-proxy-in-front-of-the-app). |
   | `ADMIN_LOGIN` | first start | Login name of the first admin: 3 to 64 characters from `a-z`, `0-9`, `.`, `_`, `-`. |
   | `ADMIN_PASSWORD` | first start | Password of the first admin: at least 12 characters and at most 72 bytes (in UTF-8). |
   | `ADMIN_NAME` | no | Display name of the first admin. Default: the login name. |

   The three `ADMIN_` variables are read only when the database has no admin account. A `.env` file is
   read from the directory the server is started in, and never overrides a variable that is already set.

4. **Start the site.**

   ```sh
   npm run dev
   ```

   This starts the API on port 3000 in development mode (it restarts when server code changes) and the
   Vite dev server on port 5173, which passes `/api` on to port 3000. Open <http://localhost:5173>.

   The script sets `NODE_ENV=development` with a shell prefix (`NODE_ENV=development tsx …`). That is
   POSIX shell syntax and was checked on macOS only.

   At its first start the server creates the tables and the first admin account. If no admin exists and
   `ADMIN_LOGIN` or `ADMIN_PASSWORD` is missing, it starts anyway and logs
   `No admin user exists and ADMIN_LOGIN/ADMIN_PASSWORD are not set; nobody can sign in.`

5. **Sign in** with `ADMIN_LOGIN` and `ADMIN_PASSWORD`. Then delete `ADMIN_PASSWORD` from `.env`: it is
   not used again. The admin's time zone starts as UTC and can be changed under the account name in the
   header (Settings). Invite learners from the **Admin** page (see
   [Accounts](#accounts-invites-and-password-resets)).

Lessons, questions, labs and flashcards are read from `content/` once, when the server starts. After you
change a content file, restart the server (`npm run dev` restarts it for code changes, not for content).

### Production mode and development mode

| | Production mode | Development mode |
| --- | --- | --- |
| When | `NODE_ENV` unset, empty, `production` or anything else | `NODE_ENV` is `development` or `test` |
| Session cookie | `__Host-sid`, with `Secure` | `sid`, without `Secure` |
| Proxies trusted (unless `TRUST_PROXY` says otherwise) | 1 | 0 |

`npm run dev` is the only script that starts the server in development mode. `npm start` does not, so the built server
runs in production mode on your own machine too, unless you set `NODE_ENV=development` yourself.

A browser keeps a `Secure` cookie only from a secure connection. In production mode the site must
therefore be reached over HTTPS; over plain HTTP the sign-in request succeeds and the next page asks you
to sign in again. The exception is your own machine: `http://localhost:PORT` works in Chromium-based
browsers (checked with Chromium 157), so the built server can be tried locally. Firefox and Safari were
not checked; if sign-in does not stick there, use `npm run dev`.

## npm scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | API in development mode, with reload, on port 3000, and Vite on port 5173. |
| `npm run build` | Builds the client into `dist/client` and compiles the server into `dist/server`. It needs only the packages under `dependencies`. |
| `npm start` | Runs the built server (`node dist/server/server/src/index.js`), in production mode unless `NODE_ENV` says otherwise. It serves the API and the built client on `PORT`. |
| `npm test` | Runs all tests once (Vitest). The server tests need `TEST_DATABASE_URL` and a running MySQL; they share one database and run one file at a time, so do not start two test runs at once. |
| `npm run typecheck` | Type-checks the client, the server and the shared code. |
| `npm run check-content` | Loads and validates everything under `content/`. Prints `Content OK: … questions, … lessons, … labs, … flashcards`, or the file, the field and the reason of the first problem, and exits with status 1. |

## Project layout

```
client/                React app (Vite, Tailwind CSS, Motion, React Router, TanStack Query)
  src/api/             the one API client, the save queue, response types
  src/features/        one folder per screen: auth, path, lesson, diagrams, questions, assessment
                       (quiz and exams), review, labs, dashboard, leaderboard, settings, admin, rewards
  src/ui/              shared components, the press guard, the theme
server/                Express API
  src/index.ts         start: configuration, content, migrations, first admin, HTTP server; shutdown
  src/app.ts           the Express app: security headers, routers, static files, error handling
  src/features/        one folder per API area (routes and database access)
  src/services/        scoring, review schedule, XP, mastery, exam assembly, study plan (no database)
  src/content/         loader, validation and lesson parser for `content/`
  src/db/              connection and migrations (`migrations/*.sql`, applied in name order)
shared/                types and the list of diagram names, used by client and server
content/               lessons, questions, labs and flashcards (see below)
docs/                  the design spec and the implementation plan
dist/                  build output (ignored by git)
```

The API is under `/api`. All grading happens on the server: a response never carries the answer, the
explanation or the reasons for a question before that question has been answered. For the same reason a
lab can only be submitted whole: `POST /api/labs/:id/submit` answers 400 unless every step has an answer,
because its response shows the solution of every step.

The production build sends a Content-Security-Policy that takes style sheets only from the site's own
files. Code that adds a `<style>` element while the page runs is blocked there, although it works under
`npm run dev`, where Vite serves the page without that policy. After adding a client library, open a
production build in a browser with the console open.

## Database migrations

Migrations are the `.sql` files in `server/src/db/migrations/`. The server applies them in file-name
order when it starts and records each in the table `schema_migrations`. Never edit a file that has been
applied; add a new numbered file.

The runner cuts a file into statements at every semicolon that ends a line, and sends each statement on
its own. So in a migration file:

- end every statement with `;` at the end of a line;
- never put a `;` at the end of a line inside a string or a comment;
- do not put a comment after a statement's `;` on the same line, and do not end the file with a comment
  after the last statement (a comment before a statement is fine);
- do not use `DELIMITER`, stored procedures, functions, triggers or events: their bodies contain
  semicolons.

MySQL commits each schema statement by itself, and a file is recorded only after its last statement. A
migration that fails halfway therefore stays half-applied and is run again from its first statement at
the next start. Keep one schema change per file, or write statements that can run twice
(`CREATE TABLE IF NOT EXISTS`).

## Adding content

Content is edited as files in this repository. There is no editor in the site.

```
content/
  manifest.json                      domains and objectives, and which are published
  domains/<domain>/<objective>/
    lesson.md                        the lesson of one objective
    questions.json                   its question bank
  labs/<lab id>.json                 one scenario lab per file
  flashcards.json                    every flashcard
```

For example, objective 2.1 lives in `content/domains/2/2.1/`.

### The id rules

Attempts, review cards, results and XP are stored against content ids, and lesson progress against
section positions. So, once content has been published:

- **Never reuse and never rename an id.** A retired question keeps its id out of use; a new question
  gets a new id.
- **Do not insert, remove or reorder the `##` sections of a lesson** that learners have started. Section
  ids are `s1`, `s2`, … by position, and progress is recorded per section id. Add new material inside a
  section, or at the end of the lesson.
- Every id is unique across its kind: question ids across all objectives (and lab step ids), flashcard
  ids, lab ids.

The ids in use follow these forms; keep to them:

| Kind | Form | Example |
| --- | --- | --- |
| Question | `q-<objective>-<3 digits>` | `q-1.1-001` |
| Flashcard | `f-<objective>-<3 digits>` | `f-1.1-001` |
| Lab | `lab-<domain>-<2 digits>` | `lab-1-01` |
| Lab step | `<lab id>-s<number>` | `lab-1-01-s1` |

Ids are stored in database columns of fixed width, so each has a maximum length: 40 characters for a
question or a lab step, 46 for a flashcard, 40 for a lab, 8 for an objective. The forms above stay far
below these.

Ids of options and items inside a question (`a`, `b`, `l1`, `r1`, …) only need to be unique within their
list.

### The manifest

`content/manifest.json` lists the five domains with their `title`, `weight` (percent of the real exam) and
`mockCount` (how many questions a practice exam draws from the domain), and each objective with:

- `published`: `false` shows the objective as "Coming soon". Set it to `true` when the objective is
  ready. A published objective must have a `lesson.md` and at least `minQuestions` questions, or the
  content check fails and the server does not start.
- `minQuestions`: that minimum.

A domain with at least one published objective is open to learners (after they pass the exam of the
domain before it). The practice exam is called partial for as long as any domain has no published
objective.

### Lessons

`lesson.md` is Markdown with front matter:

```markdown
---
objective: "2.1"
title: "Threat actors and what moves them"
minutes: 15
---

## Who attacks, and why

Text of the first section. **Bold**, *italic*, lists, links and tables are ordinary Markdown.

| Actor | Typical goal |
| --- | --- |
| Organized crime | Money |
| Hacktivist | Publicity for a cause |

> **Exam tip:** A callout is a block quote that starts with a bold label.

> **Common trap:** This is the other label that is shown as a callout.

:::diagram cia-triad

:::check q-2.1-001

## The next section

More text.
```

- `objective` (a string, the same as the directory name), `title` and `minutes` (a whole number) are
  required.
- Each `## ` heading starts a section. The learner reads one section at a time. Nothing may come before
  the first `## ` heading.
- `:::check <question id>` on a line of its own puts that question into the section. The learner must
  answer it to go on. Any question of the bank may be used.
- `:::diagram <name>` on a line of its own puts an interactive diagram there. The name must be one of the
  registered diagrams (see below).
- A block quote that starts with `**Exam tip:**` or `**Common trap:**` is shown as a callout. Any other
  block quote stays a block quote.
- Raw HTML in a lesson is shown as text, not interpreted.
- Wide tables scroll sideways on a phone. Keep tables to four columns or fewer.

### Diagrams

A diagram is a React component, not a content file. To add one:

1. Add its name to `DIAGRAM_NAMES` in `shared/diagrams.ts`.
2. Write the component in `client/src/features/diagrams/` (the existing ones use `StepDiagram`, which
   gives the Back, Next and Replay controls and the text description of each step).
3. Register it under that name in `client/src/features/diagrams/registry.tsx`.

The registered names are: `control-types-matrix`, `cia-triad`, `aaa-flow`, `zero-trust-planes`,
`change-management-flow`, `symmetric-vs-asymmetric`, `hashing-salting`, `pki-trust-chain`,
`tls-handshake`.

### Questions

`questions.json` is an array of questions. Every question has `id`, `objective` (the objective of its
directory), `difficulty` (1, 2 or 3; a first correct answer earns 10 XP times the difficulty), `type`,
`prompt` and `explanation`. Options and items are served to learners in a shuffled order. The rest
depends on the type.

**`single`**: one correct option. `why` needs one entry for every option, saying why it is right or wrong.

```json
{
  "id": "q-2.1-001",
  "objective": "2.1",
  "difficulty": 1,
  "type": "single",
  "prompt": "A group defaces a company's website to protest against its environmental record. Which kind of threat actor is this?",
  "options": [
    { "id": "a", "text": "Hacktivist" },
    { "id": "b", "text": "Insider threat" },
    { "id": "c", "text": "Nation-state" }
  ],
  "correct": "a",
  "why": {
    "a": "Correct. A hacktivist attacks to draw attention to a cause.",
    "b": "An insider has authorized access. Nothing in the scenario says the group does.",
    "c": "A nation-state acts for a government, usually quietly and for espionage."
  },
  "explanation": "Classify a threat actor by its motive. A public protest for a cause points to a hacktivist."
}
```

**`multi`**: several correct options. `correct` is an array. Say how many in the prompt with the words
`(Choose two.)`, `(Choose three.)` and so on: the site then shows a "Choose 2" hint.

```json
{
  "id": "q-2.1-002",
  "objective": "2.1",
  "difficulty": 2,
  "type": "multi",
  "prompt": "Which two attributes are typical of a nation-state actor? (Choose two.)",
  "options": [
    { "id": "a", "text": "Large resources" },
    { "id": "b", "text": "Low level of skill" },
    { "id": "c", "text": "Patience over months or years" },
    { "id": "d", "text": "A wish for publicity" }
  ],
  "correct": ["a", "c"],
  "why": {
    "a": "Correct. A government can pay for staff, tools and time.",
    "b": "Nation-state teams are among the most skilled.",
    "c": "Correct. Such actors stay hidden and work slowly.",
    "d": "They usually avoid attention. Hacktivists seek it."
  },
  "explanation": "Nation-state actors combine funding, skill and patience, and they try to stay unnoticed."
}
```

**`order`**: put items in sequence. `correct` lists every item id in the right order. An `order`
question needs at least three items.

```json
{
  "id": "q-2.1-003",
  "objective": "2.1",
  "difficulty": 2,
  "type": "order",
  "prompt": "Put these steps of a phishing attack in the order in which they happen.",
  "items": [
    { "id": "i1", "text": "The victim enters a password on a fake page" },
    { "id": "i2", "text": "The attacker sends an email with a link" },
    { "id": "i3", "text": "The attacker signs in with the stolen password" }
  ],
  "correct": ["i2", "i1", "i3"],
  "explanation": "The lure comes first, then the victim gives the password away, then the attacker uses it."
}
```

**`match`**: pair each `left` item with one `right` item. `correct` maps every left id to a different
right id. Extra right items that match nothing are allowed. On a phone the menu of answers is narrow, so
keep the right-hand texts short where you can.

```json
{
  "id": "q-2.1-004",
  "objective": "2.1",
  "difficulty": 1,
  "type": "match",
  "prompt": "Match each threat actor to its usual motive.",
  "left": [
    { "id": "l1", "text": "Organized crime" },
    { "id": "l2", "text": "Hacktivist" }
  ],
  "right": [
    { "id": "r1", "text": "A political or social cause" },
    { "id": "r2", "text": "Financial gain" }
  ],
  "correct": { "l1": "r2", "l2": "r1" },
  "explanation": "Criminal groups attack for money. Hacktivists attack for a cause."
}
```

**`categorize`**: sort items into buckets. `correct` maps every item id to a bucket id. A bucket may
take several items or none.

```json
{
  "id": "q-2.1-005",
  "objective": "2.1",
  "difficulty": 2,
  "type": "categorize",
  "prompt": "Sort each actor by where it stands in relation to the organization.",
  "items": [
    { "id": "i1", "text": "A sales employee who copies the customer list" },
    { "id": "i2", "text": "A criminal group that sends ransomware" },
    { "id": "i3", "text": "A contractor with a building badge who plugs in a rogue device" }
  ],
  "buckets": [
    { "id": "internal", "text": "Internal" },
    { "id": "external", "text": "External" }
  ],
  "correct": { "i1": "internal", "i2": "external", "i3": "internal" },
  "explanation": "An internal actor already has some authorized access. An external actor has none."
}
```

In a quiz or an exam a question counts as correct only when all of it is right. A lab gives part
marks for a step that is partly right.

### Flashcards

`content/flashcards.json` is one array for all objectives:

```json
{ "id": "f-2.1-001", "objective": "2.1", "term": "Hacktivist", "definition": "A threat actor who attacks to promote a political or social cause." }
```

When a learner finishes the lesson of an objective, that objective's flashcards become review cards, due
the same day.

### Labs

A lab is one scenario with several steps. Each step is a question of any of the five types, written
exactly as above, with an id of the form `<lab id>-s<number>`. `objectives` lists the objectives the lab
covers; the `objective` of every step must be one of them. A lab opens for a learner once they have
finished the lessons of all its objectives. A lab is submitted whole: every step must have an answer.
The score is the average of the step marks, and 80% passes.

```json
{
  "id": "lab-2-01",
  "domain": 2,
  "objectives": ["2.1"],
  "title": "Name the attacker",
  "scenario": "The text the learner keeps in view while working through the steps.",
  "steps": [
    {
      "id": "lab-2-01-s1",
      "objective": "2.1",
      "difficulty": 1,
      "type": "single",
      "prompt": "…",
      "options": [{ "id": "a", "text": "…" }, { "id": "b", "text": "…" }],
      "correct": "a",
      "why": { "a": "…", "b": "…" },
      "explanation": "…"
    }
  ]
}
```

All steps of a lab are on one page, so do not let the text of one step give away the answer to another.

### Checking content

```sh
npm run check-content
```

It reports the first problem with its file and field: invalid JSON or a missing field, a duplicate id,
an id that is too long, an `order` question with fewer than three items,
an answer that names an unknown option, an option without a `why`, a lesson that names an unknown
diagram or question, a published objective without a lesson or with too few questions. The server runs
the same check when it starts and does not start if it fails, and `npm test` runs it on the real content.
Run it before every commit that touches `content/`.

## Accounts: invites and password resets

There is no public sign-up, and the site sends no email.

- **Invite a learner.** On the **Admin** page press **Create invite link**. The link is shown once.
  Copy it and send it to the learner yourself, privately. It works once and expires after 7 days. The
  learner opens it and chooses a login name, a display name (at most 64 characters) and a password (at
  least 12 characters, at most 72 bytes).
- **Forgotten password.** On the Admin page press **Password reset link** in the learner's row and pass
  the link on. It works once and expires after 7 days. Setting the new password signs the learner out
  everywhere and cancels every other unused reset link of that account.
- **Deactivate.** A deactivated learner is signed out, cannot sign in and leaves the leaderboard. Their
  progress is kept, and **Activate** brings the account back.
- Anyone who has an unused link can use it. A link that was made by mistake cannot be withdrawn from the
  Admin page; it stops working when it expires (a reset link also when another reset link of the same
  account is used).
- The first admin comes from the environment variables (see [Local setup](#local-setup)). The site has
  no screen for creating another admin.

## Security notes for the operator

- **Secrets live only in environment variables** (on your machine: in `.env`, which git ignores). Never
  commit a password, a database URL, an invite link or a reset link.
- **The repository is public, so the question bank and its answers are readable by anyone.**
  Grading on the server keeps scores, XP and progress honest. It does not keep the answers secret.
- **Remove `ADMIN_PASSWORD` from the environment after the first start.** It is only read while no admin
  exists, but it should not stay stored where it is not needed.
- Passwords are stored as bcrypt hashes (cost 12). Session ids and link tokens are stored as hashes.
- The session cookie is `HttpOnly` and `SameSite=Lax`. In production mode it is named `__Host-sid` and
  carries `Secure`; a browser accepts a cookie of that name only from this host, over a secure
  connection. In development mode it is named `sid` and has no `Secure`. A session lasts 30 days from its
  last use.
- Every request that changes something must carry the header `X-Requested-With: secplus`, which a form
  on another site cannot send.
- Sign-in is limited to 10 failed requests per address in 15 minutes; successful sign-ins do not count,
  so learners who share an address do not use up each other's attempts. Sign-in is also limited to 5
  failures per login name in 15 minutes, whoever makes them and whether or not the name exists. Accepting
  an invite and resetting a password share a second limit of 10 failed requests per address in 15
  minutes. A request over a limit is answered with status 429 and "Too many attempts. Try again later."
  These counters are kept in the memory of the one server process and start again when it restarts.
- Responses carry a Content-Security-Policy that allows scripts and style sheets only from the site
  itself, and the other Helmet headers, including `Strict-Transport-Security`.
- API responses are sent with `Cache-Control: no-store`. The files under `/assets` may be cached for a
  year (their names change with every build), and the page itself is checked again on every load.

## Deploying to Hostinger

The site is one Node.js application that serves both the API and the built client. Hostinger builds it
from this GitHub repository.

| Setting | Value |
| --- | --- |
| Build command | `npm run build` |
| Start command | `npm start` |
| Node.js version | 20.19 or later in the 20 line, or 22.12 or later (not 21) |

Environment variables:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | `mysql://USER:PASSWORD@HOST:PORT/DATABASE` of the Hostinger MySQL database |
| `NODE_ENV` | `production`. The app behaves as production when it is unset too (and puts Express itself into production mode), but set it anyway, so that nothing else guesses. |
| `TRUST_PROXY` | the number of reverse proxies in front of the app. Leave it unset for one proxy. See below how to check it. |
| `ADMIN_LOGIN` | login name of the first admin |
| `ADMIN_PASSWORD` | its password, at least 12 characters and at most 72 bytes. **Remove this variable after the first start.** |
| `ADMIN_NAME` | its display name (optional) |

`PORT` is read if the host sets it; the default is 3000.

What the deployment depends on:

- **The build works with or without the dev dependencies installed.** When `NODE_ENV=production` is set,
  npm installs `dependencies` only; everything `npm run build` needs is there.
- **The app must be started from the repository root**, with the source tree in place; `npm start` does
  that. It reads `content/`, `server/src/db/migrations/` and `dist/client/` (and a `.env`, if there is
  one) relative to the working directory. Started from anywhere else it stops at once and names the first
  thing it could not read, for example
  `content/manifest.json: file: cannot read file: ENOENT: no such file or directory, open 'content/manifest.json'`.
- **What happens at start.** The server checks its configuration, then loads and validates the content,
  then connects to the database, applies the migrations and creates the first admin if there is none. The
  database user needs the right to create and alter tables. If a step fails, the process prints one line
  and exits with status 1:

  | Line starts with | Meaning |
  | --- | --- |
  | `Configuration error:` | `DATABASE_URL` is missing, or `TRUST_PROXY` is not a whole number |
  | `<file>: <field>: <reason>` | a content file is missing or invalid |
  | `Cannot read the migrations directory` | started from the wrong directory, or the source tree is incomplete |
  | `Database unavailable at startup:` | the database could not be reached |
  | `Database migration failed:` | a migration file could not be applied |
  | `Admin bootstrap failed:` | `ADMIN_LOGIN` or `ADMIN_PASSWORD` breaks its rule (see [Local setup](#local-setup)) |
  | `Cannot listen on port N:` | the port is in use |

- **Stopping.** On `SIGTERM` or `SIGINT` the server stops taking connections, lets the requests in
  progress finish, closes its database connections and exits with status 0. If that takes more than 10
  seconds it exits with status 1. A `SIGTERM` sent to `npm start` reaches the server.
- **Health check:** `GET /api/health` answers `{"ok":true}`. It shows that the process is serving
  requests. It does not query the database.
- **HTTPS.** In production mode the session cookie is `__Host-sid` with `Secure`, so browsers keep it
  only over HTTPS (and on `localhost`, see [Production mode](#production-mode-and-development-mode)). The
  proxy in front of the app must serve the site over HTTPS, or nobody can stay signed in. The app does
  not redirect HTTP to HTTPS itself.
- **One process.** The sign-in counters are in memory. Sessions and all learner data are in MySQL, so a
  restart signs nobody out.
- Requests the database cannot serve get status 503, and the client shows a retry screen.

### The proxy in front of the app

The limits on sign-in attempts are counted per client address. Behind a reverse proxy the app sees the
proxy's address, and learns the client's from the `X-Forwarded-For` header. `TRUST_PROXY` says how many
proxies to believe, and it must equal the real number:

- **Too low**, and every visitor appears to come from the proxy's address and shares one limit: ten
  failed sign-ins by anyone lock sign-in for everyone for 15 minutes.
- **Too high**, and the app believes an `X-Forwarded-For` address that the visitor made up, so the limit
  can be dodged.

Unset, it is 1 in production mode, which is right for one proxy. A CDN in front of the host is a second
proxy. How many proxies Hostinger puts in front of an app has not been checked: check it after the first
deployment, in both directions. Both checks lock sign-in for a while for the address that runs them; the
counters clear after 15 minutes or when the app restarts.

1. **Is it too low?** From one network, fail to sign in ten times with a login name that does not exist,
   such as `nobody` (use a made-up name: five failures lock a login name for 15 minutes, and that must not
   be the admin's). Then sign in with a real account from a different network, such as a phone on mobile
   data. That must work. If it answers "Too many attempts. Try again later.", `TRUST_PROXY` is too low.

2. **Is it too high?** From one connection, send eleven failed sign-ins, each with another made-up
   `X-Forwarded-For` header and another made-up login name:

   ```sh
   for i in $(seq 1 11); do
     curl -s -o /dev/null -w '%{http_code}\n' -X POST https://sec.networkitout.com/api/auth/login \
       -H 'Content-Type: application/json' -H 'X-Requested-With: secplus' \
       -H "X-Forwarded-For: 203.0.113.$i" \
       -d "{\"login\":\"nobody$i\",\"password\":\"not-a-real-password\"}"
   done
   ```

   The first ten must print `401` and the eleventh `429`. If the eleventh prints `401` too, the app
   believed the made-up addresses: `TRUST_PROXY` is too high.

### Trying the production build on your own machine

```sh
npm run build
PORT=3999 npm start
```

Then open <http://localhost:3999>. `npm start` runs in production mode, so the cookie is `__Host-sid`
with `Secure`; Chromium-based browsers keep it on `http://localhost`, so sign-in works there. No proxy is
in front of the app on your machine, so with the default of one trusted proxy it would believe an
`X-Forwarded-For` header you send. Set `TRUST_PROXY=0` there if you try the two checks above.

## Release checklist

Each step below reaches outside this repository. The owner approves and performs them.

- [ ] Create the MySQL database on Hostinger, and set the environment variables `DATABASE_URL`,
      `NODE_ENV=production`, `ADMIN_LOGIN`, `ADMIN_PASSWORD` and `ADMIN_NAME` for the app. Leave
      `TRUST_PROXY` unset unless you know the number of proxies is not one.
- [ ] Set the app's build command to `npm run build`, its start command to `npm start`, and its Node.js
      version to 20.19 or later in the 20 line, or 22.12 or later.
- [ ] Push the branch `phase-1`.
- [ ] Merge `phase-1` into `main`. This triggers the deployment to `sec.networkitout.com`.
- [ ] After the deployment, open `https://sec.networkitout.com/api/health` and check that it answers
      `{"ok":true}`.
- [ ] Sign in as the admin over `https://` and create the first invite link.
- [ ] Remove `ADMIN_PASSWORD` from the Hostinger environment variables.
- [ ] Check the proxy count in both directions (see
      [The proxy in front of the app](#the-proxy-in-front-of-the-app)): ten failed sign-ins from one
      network must not stop a sign-in from another network; and eleven failed sign-ins from one
      connection, each with another made-up `X-Forwarded-For` header, must end in `429`. If either check
      fails, correct `TRUST_PROXY` and restart the app.

## License

MIT. See [LICENSE](LICENSE).
