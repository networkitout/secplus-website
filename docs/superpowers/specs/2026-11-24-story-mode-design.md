# Story Mode: Turning the Security+ Site into a Training Game

Date: 2026-11-24
Status: draft for owner review, then hand-off to a builder (OpenCode)
Builds on: `docs/superpowers/specs/2026-11-10-secplus-training-site-design.md` (phase 1, live)

Labels used in this document:
- **[Owner]** the site owner decided this in conversation.
- **[Designer's call]** proposed by the designer and not yet confirmed; the builder may raise objections.
- **[Builder]** left for the builder to decide.

---

## 1. Why

The phase 1 site is live at `https://sec.networkitout.com`. When the owner saw it for the first time,
their verdict was that it "seems more like an exam prep" when it is "supposed to train".

What it does today: for each exam objective, one 15–20 minute article, then quizzes, domain exams,
mock exams, flashcards, a readiness score and a leaderboard. Domain 1 has about 11,500 words of
reading against 132 questions. Most of the product measures knowledge; little of it builds knowledge
or skill.

The owner's goal, in their words: **"I want learning to be the side effect of an engaging game/story."**

The learner should feel they are playing a story about working on a security team. They should come
out of it able to pass Security+ (SY0-701) without the experience feeling like coursework.

## 2. Who it is for

Unchanged from phase 1:
- A small private group invited by the owner. Accounts are invite-only.
- Learners have some IT experience (help desk, A+ or Network+ level).
- The goal is to pass SY0-701. The course must still cover every one of the 28 objectives.

## 3. Goals, non-goals, anti-goals

**Goals**
- A branching story is the main way learners move through the material. [Owner]
- Choices have consequences that carry forward and can change later chapters. [Owner]
- Knowledge arrives inside the story world, at the moment the story needs it. [Owner: story first, learning as a side effect]
- Hands-on simulations of real security tasks, in the story company's own tools.
- Every learner meets every exam objective, whatever they choose.
- The exam-prep tools stay available as a secondary area.

**Non-goals**
- Real-time pacing (messages that arrive hours apart). The owner mentioned *Lifeline* only for its
  consequence-driven choices, not its format. [Owner]
- A chat-only interface.
- Multiplayer or a shared story between learners. Each learner has their own company. [Designer's call]
- Voice, video or 3D graphics.
- Rewriting the server foundations: accounts, sessions, XP, badges, leaderboard, review cards and
  assessments stay.

**Anti-goals: the project fails if any of these happen, even when it technically works**
- The story is a thin wrapper around quiz questions ("The CISO asks you question 4 of 10").
- Briefings read like textbook chapters in costume.
- A learner can finish the story without having met every objective.
- Bad choices end the game or lock the learner out of the syllabus.
- The story contradicts the exam. Where the story's world and CompTIA's terms differ, CompTIA wins.

## 4. The experience

### 4.1 The company [Owner: online retailer with warehouses]

A growing online retailer that runs its own warehouses. It was chosen because almost every objective
has a natural home there:
- a public website, customer accounts and card payments
- cloud systems and on-premises servers
- warehouses with handheld scanners, cameras, badge readers and conveyor controls, giving physical
  security, IoT and industrial control systems
- delivery partners, suppliers and software vendors, giving third-party risk
- office staff, warehouse staff and remote workers
- a compliance obligation for card payments, plus privacy law for customer data

A regional hospital was considered and rejected. The owner found it attractive, but it fits cloud,
payments and supply-chain topics poorly, and its healthcare details would distract from general
concepts.

The company name and branding are [Builder]. They must be fictional and must not imitate a real
retailer.

### 4.2 The learner's role: a career that follows the syllabus [Owner]

| Domain | Learner's role | Kinds of decisions |
| --- | --- | --- |
| 1 General Security Concepts | New security analyst | Classifying controls, basic crypto choices, following change management |
| 2 Threats, Vulnerabilities, Mitigations | Analyst | Spotting threats and attack indicators, recommending mitigations |
| 3 Security Architecture | Promoted to security engineer | Designing networks, protecting data, resilience and backups |
| 4 Security Operations | Leads operations and incident response | Hardening, monitoring, identity, responding to incidents |
| 5 Program Management and Oversight | Security manager | Governance, risk, third parties, compliance, audits, awareness |

Promotions are story events and also game rewards. A learner's record affects how a promotion is
framed, not whether it happens. [Designer's call]

### 4.3 The cast [Designer's call]

A recurring cast in roles the exam cares about. Each character has a personality and an agenda, and
disagreements between them carry much of the teaching:
- **CISO:** accountable for security; the learner's eventual boss.
- **Risk owner(s):** business leaders who own particular risks, for example the head of e-commerce or
  of warehouse operations.
- **Tech lead:** competent and impatient; likes to make calls that aren't theirs.
- **Senior analyst / mentor:** explains things over coffee, the main voice of the briefings.
- **IT operations and developers.**
- **Warehouse manager:** physical security and operational technology.
- **Procurement / vendor manager:** third-party risk.
- **Data protection officer / legal**, and later **an external auditor**.
- **Someone in finance** who receives the phishing email.

### 4.4 How choices carry forward [Owner]

The owner's two examples define the feel.

**Precedent (governance).** Early on, the tech lead makes a policy call that belongs to the risk owner
or the CISO, and someone challenges it. If the learner lets it stand, nothing bad happens at once, and
it may even look efficient. Later, another person without authority makes a bigger call, citing the
first as "how we do things here", and that causes real harm: a risk accepted that nobody owned, an
unapproved exception, an audit finding. The ending traces the harm back to the first choice. The
lesson is *why* governance roles matter, not just what they are called.

**Technical decision (cryptography).** The company must choose how to encrypt its SQL database
backups. A weak or wrongly scoped choice can come back later, for example as a leaked backup during
an incident or an audit finding.

**Mechanism: branch and rejoin [Designer's call]**
- The story keeps a record of **state**:
  - **precedents and company habits:** shortcuts allowed, approvals skipped, decisions made by the
    wrong person
  - **technical posture:** for example, whether backups are encrypted properly
  - **relationships:** how much the CISO trusts the learner
  - **resources:** the security budget
  - **named facts:** which vendor was signed
- Later scenes read the state to change dialogue, unlock or prevent incidents, and escalate
  consequences.
- The story **rejoins at milestones**: key events every learner reaches, so every objective is met.
  Between milestones, scenes and incidents differ by learner.
- **Bad choices teach rather than punish.** A poor decision creates a harder situation, often an
  incident, and handling incidents is itself syllabus (objective 4.8, incident response). There is no
  game over.
- **Callbacks:** later scenes refer back to earlier choices by name ("remember the backup
  decision?") even when they don't branch.
- **Endings:** each domain closes with a short recap of how the company fared and which decisions led
  there. The full story has several endings.
- **Replay:** after finishing a domain, the learner can replay it to try other choices. Replays don't
  award first-time XP again. [Designer's call]

### 4.5 What a scene contains

Scenes are the unit of play. A scene mixes these elements:
- **Narrative and dialogue:** short, in the second person, one screen at a time.
- **Decision:** a choice, usually 2–4 options, put to the learner by a character in the story (the
  tech lead in a meeting, the CISO by message). Decisions are never presented as numbered quiz
  questions.
- **Briefing (in-world teaching):** the knowledge needed to decide well, presented as something a
  person at work would actually see: the mentor explaining something, a company wiki page, a vendor
  datasheet, a runbook, an auditor's email, a short internal training deck. Each briefing covers
  specific objective sub-points and takes about 1–4 minutes.
  - **Rule:** the first time a decision depends on a concept the learner hasn't met, its briefing
    is required before deciding. After that, briefings are optional refreshers, reachable from the
    company wiki at any time. [Designer's call; the owner agreed to "story first"]
- **Tool (simulation):** a hands-on task in the company's tools. See 4.6.
- **Debrief:** after a consequential decision, a short explanation of the reasoning, so learning
  happens even after a bad choice. It names the CompTIA terms and links to the relevant briefing.
- **Exam-style moments:** some decisions are deliberately phrased the way the exam phrases things
  (scenario, "BEST", "FIRST"), so the transfer to the exam is direct. Most are not.

### 4.6 Simulations (company tools)

Each one teaches by doing, and each produces a result the story can react to. Domain 1 needs:
- **Hash checker:** hash two versions of a file, see the avalanche effect, verify a download, and
  see why salting changes stored password hashes (1.4).
- **Certificate inspector:** open the company web portal's certificate, walk the chain to a root, and
  spot an expired or self-signed certificate (1.4).
- **Encryption planner:** pick algorithm, key length and key storage (TPM, HSM, key management
  system) for scenarios like the SQL backups (1.4).
- **Change request board:** fill in a change request (impact analysis, test results, backout plan,
  maintenance window) and watch an unplanned change go wrong (1.3).
- **Control mapper:** classify the controls in a walk-through of a warehouse by category and type
  (1.1).
- **Zero-trust access desk:** decide what a policy engine should allow for given subjects, devices and
  resources (1.2).
- **Physical security walk-through:** pick the right physical controls for a warehouse gate, server
  room and loading dock (1.2).

Later domains need log triage (2.4, 4.9), firewall rule building (3.2, 4.5), a phishing inbox (2.2,
5.6), vulnerability scan prioritising (4.3), identity and access requests (4.6) and an incident
timeline (4.8). Their exact design is [Builder], one domain at a time.

Simulations must work by keyboard and touch and respect reduced motion. That already holds for the
existing question components.

### 4.7 The home screen and navigation

- **Home becomes the story:** "Continue" (the current scene), the learner's role and chapter, the
  company's state at a glance (trust, budget, open incidents), and recent consequences.
- **Company wiki:** every briefing the learner has unlocked, searchable, organised both by story and
  by exam objective.
- **Exam prep (secondary area):** the existing quizzes, domain exams, mock exams, flashcards, review
  queue and readiness check, moved out of the main path. The story never stops to quiz the learner.
  Domain exams no longer gate story progress. [Designer's call; the story's milestones gate it instead]
- **Leaderboard, XP, levels, streaks and badges** stay. Story actions earn XP. New badges cover story
  achievements, for example "kept every precedent clean in Domain 5". Story choices are never shown
  to other learners.

### 4.8 Learning, measurement and remediation

- **Decisions are evidence of mastery.** Each decision option is tagged with the objective(s) it
  tests and whether it is the sound choice. Mastery per objective combines story decisions,
  simulation results and any exam-prep answers. [Designer's call]
- **Remediation that teaches:** a poor decision leads to a debrief, which links to the exact
  briefing, and the concept is scheduled into the review queue (the existing spaced repetition).
- **Readiness** keeps the phase 1 rule: three mock exams averaging 800+ and every domain at 80%+
  mastery. Mastery now also counts story evidence.

## 5. Coverage guarantee

- **Every objective must be covered on the main path:** at least one required briefing and at least
  one decision or simulation on a path every learner takes (a milestone or a scene every branch
  passes through).
- **A content check enforces this automatically,** in the same spirit as the existing
  `npm run check-content`. It fails the build when an objective has no required coverage or a story
  reference points at a missing briefing, simulation or objective.
- **CompTIA terms must match the official SY0-701 objectives document.** The phase 1 manifest's
  objective and domain titles are still unverified and should be checked against the official PDF
  before story writing starts.

## 6. Approaches considered (how the story engine is built)

| | Approach | Trade-off |
| --- | --- | --- |
| **A (chosen)** | **Ink** (inkle's open-source narrative scripting language) with its JavaScript runtime **inkjs** | Branching, rejoining, variables and conditions are built in and proven in shipped games. Stories are plain text files that a person or an LLM can write. Cost: a new language for writers, and objective coverage needs our own check on top. |
| B | A custom scene format (JSON/YAML scene graph) with our own engine | Full control and a natural fit with the existing content checker. Cost: rebuilding what Ink does, including the hard parts (state, conditions, rejoining, save/restore). |
| C | Twine | Popular for interactive fiction, but built to publish standalone stories. Hard to tie into accounts, server-side saves and XP. |

**Choice: A. [Owner]** The owner chose Ink after seeing these three options.

## 7. Technical design

### 7.1 Decided [Designer's call unless marked]

- **Story source:** `.ink` files under `content/story/`, one folder per domain. Compiled to JSON at
  build time. Check whether the `inkjs` package's bundled compiler can do this without an external
  binary, and pin the exact version. The compiled JSON is a build artifact and is not committed.
- **The story runs on the server, not in the browser.** The server holds each learner's Ink state,
  advances it, and sends the client only the current scene's text, choices and any embedded elements.
  Reasons:
  - Consequences and the "sound" choices stay hidden. The phase 1 rule was that answers are never
    sent before the learner commits, and it carries over.
  - XP and leaderboard integrity.
  - Saves work across devices automatically.
- **Saved state:** a new table holds per-learner story state: the Ink state JSON per domain, the
  current position, and a log of decisions made, with timestamps and objective tags. The decision log
  feeds mastery, the domain recap and the "how we got here" ending. Ink state from a superseded story
  version needs a migration strategy, see 7.2.
- **Embedding teaching in the story:** Ink tags (or a small convention of directives in Ink lines) mark
  where a scene shows a briefing, a simulation, a decision with objective tags, or a debrief. The
  server resolves these against content files and returns structured elements to the client.
- **Briefings** are content files (Markdown with front matter, like phase 1 lessons), each tagged with
  objective IDs and sub-points. The phase 1 lesson renderer and sanitiser can be reused.
- **Simulations** are React components registered by name, like the phase 1 diagrams. Each takes
  inputs from the scene, reports a structured result to the server, and the server feeds the result
  back into Ink variables.
- **What stays as is:** accounts and invites, sessions, the CSRF header, XP/levels/streaks/badges,
  the leaderboard, review cards (Leitner), assessments (quizzes, domain and mock exams), admin, the
  security posture, and the deployment.
- **What is replaced or demoted:**
  - The phase 1 lesson player and path map are replaced by the story player and story home.
  - Phase 1 labs become exam-prep practice.
  - Phase 1 Domain 1 lessons become source material for Domain 1 briefings and are rewritten in the
    in-world voice.
  - The 132 Domain 1 questions stay in exam prep.

### 7.2 Left to the builder

- The exact Ink tag/directive syntax, and the server API shape for advancing the story.
- How story state survives a story content update (versioned stories, a rejoin-at-milestone fallback,
  or similar). It must never lose a learner's progress or crash on a stale state.
- The design of each simulation's interface.
- How decision evidence and exam-prep evidence are weighted in mastery.
- Visual style of the story player. Keep the existing design tokens, dark and light themes,
  accessibility rules and reduced-motion support.
- Company name and character names.

## 8. Constraints the builder must respect (from the live system)

- **Repository:** `github.com/networkitout/secplus-website`. **`main` auto-deploys to Hostinger**
  (`sec.networkitout.com`). Work on branches and merge only with the owner's approval.
- **Stack:**
  - server: Node 22, TypeScript, Express 5, MySQL 8 (`mysql2`)
  - client: React 19, Vite, Tailwind CSS 4, Motion, React Router 7, TanStack Query 5
  - tests: Vitest
- **Hostinger starts the app through LiteSpeed's `lsnode.js`, which `require()`s
  `dist/server/server/src/index.js`.**
  - No top-level `await` anywhere in the server's import graph.
  - The app must call `listen()` within about 3 seconds of starting.
  - Check with `node -e "require('./dist/server/server/src/index.js')"` after `npm run build`.
- **Database changes** go in new numbered migration files under `server/src/db/migrations/`. Never
  edit `001_init.sql`.
- **All grading and story advancement happens on the server.** Responses never include outcomes,
  sound-choice flags or explanations before the learner commits.
- **Security posture stays:** strict CSP with no inline scripts, parameterized SQL, Zod validation on
  every route, sanitised Markdown from repo files only.
- **Accessibility:** WCAG 2.2 AA, every interaction by keyboard, visible focus, nothing conveyed by
  colour alone, reduced motion honoured.
- **All content is original.** Never reproduce real exam questions or third-party text. The company
  and characters are fictional.
- **Before merging:** `npm run typecheck`, `npm test`, `npm run check-content` and `npm run build`
  all pass. The README covers local setup (Node, local MySQL, `.env`).

## 9. Delivery

1. **Engine + Domain 1 story** (proof): the story engine, story player, story home, company wiki,
   exam-prep area, the coverage check, the Domain 1 simulations listed in 4.6, and Domain 1 written as
   a branching story that covers objectives 1.1–1.4. The owner plays it before more is written.
2. **Domains 2–5,** one at a time, each with its own simulations, briefings and story chapters. The
   governance precedent (4.4) is seeded in an early domain and pays off in Domain 5, so the outline
   for all five domains (milestones and the main state variables) is written in step 1, even though
   only Domain 1 is fully written then.

## 10. Rules settled during design review

A builder read this document cold and raised the questions below. These are the answers.

**Cutover (no learner data to migrate)**
- The site went live on 2026-11-24 with only the owner's admin account. Story mode replaces the
  lesson player and path map with a hard switch. No feature flag and no migration of lesson progress
  are needed.
- Old routes (`/` path map, `/lesson/:objective`) redirect to the story home and the matching wiki
  briefings.
- Lesson-completion XP and the `first-lesson` badge are retired. XP already earned stays. [Designer's
  call]

**What "meeting an objective" means**
- An objective is met when the learner has seen its required briefing(s) and made its required
  decision(s) or completed its required simulation(s). The quality of the choice does not matter.
  This follows from "no game over". [Designer's call]
- Milestones gate on reaching them, not on mastery. A learner who chooses badly every time still
  progresses, with a harder story and more review cards. [Designer's call]

**How coverage is checked**
- The check combines two parts. [Designer's call]
  1. **Milestone check:** authors mark milestone knots, and the check confirms each objective's
     required elements sit in milestone content.
  2. **Automated playthroughs:** a test drives the compiled story through every choice combination
     where feasible, or a large seeded random sample of combinations, and asserts that every path
     reaches every milestone and meets every objective.
- Static graph analysis of Ink is not required.

**Objective list and sub-points**
- The builder verifies the 5 domain titles and 28 objective titles, and builds the sub-point list
  (the bullets under each objective), from CompTIA's official SY0-701 exam objectives document.
- If the builder can't obtain it, the owner downloads it from comptia.org and adds it to the repo
  outside `content/`. It is reference only and never published.
- The verified list goes into `content/manifest.json`, with sub-point IDs (for example `1.4.hashing`)
  that briefings and decisions use as tags. [Designer's call]

**Mastery from story evidence**
- Each decision option is tagged **sound**, **acceptable** (a defensible trade-off) or **poor**,
  scoring 1, 0.5 and 0. Simulations score 0–1. [Designer's call]
- The latest attempt per decision or simulation counts, which matches phase 1's "most recent answer"
  rule. Replays don't count (see replays below).
- Readiness keeps requiring three mock exams averaging 800+. Domain mastery can come from story
  evidence, exam-prep answers or both. A story-only learner can reach readiness by playing the story
  and taking the mock exams; the mocks stay required. [Designer's call]

**Simulations**
- The server decides every simulation's result. The client sends the learner's inputs; the scoring
  logic lives on the server, like phase 1 grading. [Designer's call]
- Retries are allowed. The first completed attempt sets XP; the latest attempt counts for mastery.
  [Designer's call]
- **Domain 1 proof scope:** four bespoke simulations are required: hash checker, certificate
  inspector, encryption planner, change request board. The other three (control mapper, zero-trust
  access desk, physical security walk-through) may be built from the existing `order`, `match` and
  `categorize` question components, dressed as company tools. The phase 1 diagrams (hashing,
  PKI chain, change management, control types, zero trust) can be reused inside briefings.
  [Designer's call]

**Replays**
- A replay is a sandbox copy. It never changes the learner's real story state, decision log, mastery
  or the precedents later domains read. The learner's first playthrough is their history. [Designer's
  call]

**Story updates after learners have started**
- Each domain's compiled story carries a version. If a deploy changes a domain's story and a learner's
  saved state can't be loaded, the learner restarts at the most recent milestone they reached. They
  keep their decision log and the state variables recorded there, and see a short "the story was
  updated" note.
- Losing progress past the last milestone is acceptable; crashing or losing the decision log is not.
  [Designer's call]

**Compiling Ink**
- Stories compile in a build step (an npm script that runs before or with `npm run build`), never when
  the server starts. The server loads precompiled JSON synchronously with the inkjs runtime, keeping
  the lsnode `require()` and 3-second listen constraints. [Designer's call]

**XP and the leaderboard**
- One leaderboard on one XP scale. Story XP per hour of play should be about what an hour of phase 1
  exam-prep practice earned, so neither path dominates. Exact amounts are [Builder]. [Designer's call]

**Who writes the story, and who checks it [Owner]**
- The builder writes all story, dialogue, briefing and simulation-scenario text.
- **A separate AI review pass checks technical accuracy** of every briefing, decision and debrief
  against the official SY0-701 objectives before the owner plays anything. The reviewer is not the
  agent that wrote the text. It reports errors; it does not rewrite. It checks:
  - wrong or outdated technical claims
  - terms that differ from CompTIA's
  - "sound" options that are not clearly best
  - objectives or sub-points claimed but not actually taught
- The owner is the final judge of whether it plays like a story. They play the vertical slice, then
  Domain 1.
- **Target size for Domain 1** [Designer's call]: about 25–35 scenes and roughly 2–3 hours of play
  on a first run, with 2–3 consequential decisions per objective, at least one of which carries
  forward.

**Checkpoint before the full Domain 1**
- The owner plays a vertical slice first: the engine plus one complete chapter (objective 1.1:
  scenes, one briefing, one simulation, one carried-forward consequence). The rest of Domain 1 is
  written after the owner approves the slice. [Designer's call]

## 11. Success criteria

- The owner plays Domain 1 and says it feels like a story they want to continue, not a course.
- In Domain 1, two learners who choose differently see visibly different consequences, yet both meet
  every objective 1.1–1.4 (verified by the coverage check).
- A learner who makes a poor choice ends up understanding why, through the debrief and briefing,
  without being blocked.
- After all five domains, mock exam results show learners reaching the readiness bar without having
  studied outside the site.
