---
objective: "1.3"
title: Change management and its impact on security
minutes: 16
---

## Why change is a security problem

Many outages and security holes are self-inflicted. An administrator opens a firewall port "just for today". Someone installs an update that nobody tested. A setting is edited by hand at 16:55 on a Friday and never written down. The system worked yesterday. Today it is down, or it is open to the internet, and nobody can say what changed.

**Change management** is the formal process an organization uses to control changes to its systems. A *change* is anything that alters a production system (a system the business relies on for live work): a patch, a firewall rule, a new software version, a replaced switch, an edited setting. Under change management, every change is requested, assessed, tested, approved, scheduled, carried out, checked and documented.

This matters to security for four reasons:

- **Availability.** An untested change can take a service down. An outage you caused hurts the business as much as one an attacker caused.
- **New holes.** A change that nobody reviewed can weaken a control: a firewall rule that is too broad, an upgrade that turns an insecure setting back on, a monitoring agent that no longer starts.
- **Accountability.** If every approved change has a record, anything without a record stands out. Without records, you cannot tell an administrator's quick fix from an attacker's work.
- **Reversibility.** A change that was planned and documented can be undone. A change that nobody remembers cannot.

Here is a typical failure. A clinic's administrator opens an inbound port so that a vendor can fix a scheduling system. No request, no review, no note. The vendor finishes in an hour. The port stays open for eight months, until an attacker finds it. No single step was malicious. The process was missing.

> **Exam tip:** This objective says "explain the importance". Expect questions that describe something that went wrong, or is about to, and ask which part of the change management process prevents it.

:::check q-1.3-001

## The path of a change

A controlled change follows broadly the same path every time.

:::diagram change-management-flow

Organizations differ on one detail: some approve the change first and then test it before go-live. The rule underneath is the same: nothing reaches production until it has been both tested and approved. On the exam, treat test results as evidence the approvers ask for: a change that has not been tested is not ready for approval.

1. **Request.** Someone submits a change request that says what will change, why, and on which systems.
2. **Impact analysis.** The change is assessed: who and what is affected, and what could go wrong.
3. **Test.** The change is tried somewhere safe, and the test results are recorded.
4. **Approval.** The people authorized to decide, often a change advisory board (CAB), review the request, the impact analysis and the test results. They say yes, no, or "not like this".
5. **Maintenance window.** The window is proposed in the request and approved with it. The work then waits for that window.
6. **Implement.** The change is made, exactly as approved.
7. **Verify or back out.** The team checks that everything works. If it does not, they return the system to its previous state.
8. **Update documentation.** Diagrams, procedures and records are brought up to date, and the change is closed.

Urgent does not mean uncontrolled. When a flaw is being attacked right now, waiting a week for the next approval meeting is not acceptable, and neither is patching in secret. Most organizations have an *emergency change* procedure: as much testing as time allows, a faster approval by a small group, the change itself, and the paperwork completed right afterward.

> **Exam tip:** When an answer choice skips a step ("it is only a small change", "we can document it later", "the window is open anyway"), it is almost always the wrong answer. The exam rewards following the process.

:::check q-1.3-002

## Who is involved: ownership, stakeholders and approval

Three groups of people appear in every change, and the exam expects you to tell them apart.

| Term | Who they are | What they do |
| --- | --- | --- |
| **Ownership** | The person or department that needs the change and is accountable for it | Requests the change, follows it from start to finish, and confirms the result is acceptable |
| **Stakeholders** | Everyone the change affects | Are consulted about the impact and told what will happen and when |
| **Approval process** | The people authorized to decide, often a change advisory board (CAB) | Review the request and approve, reject or send it back |

**Ownership.** Every change has one owner. The owner is accountable: if you want to know the state of the change, you ask the owner. The owner is usually the owner of the system, application or data being changed, and is often not the person who does the technical work. If the manager of a hospital laboratory needs a new results-export module added to the laboratory information system, the laboratory manager owns the change and IT technicians carry it out.

**Stakeholders.** A stakeholder is anyone with an interest in the change because it affects them. The list is usually longer than it first appears. Replacing a Wi-Fi controller in a hospital affects the nurses with tablets, but also the team whose medical devices report over Wi-Fi, and the help desk that takes the calls on Monday morning. A stakeholder who was never asked is how a "simple" change breaks something nobody on the project knew about.

**Approval process.** Approval is a formal decision by someone other than the person making the change. In larger organizations the decision belongs to a **change advisory board** (CAB, also called a change control board): a group with members from IT, security and the business that reviews change requests. The approvers look at the reason for the change, its scope, its schedule, the impact analysis, the test results, and the plan for undoing it. Having security represented is the point at which someone asks, "does this open anything up?"

> **Common trap:** The owner is not the person who types the commands, and the owner does not approve their own change alone; the decision belongs to the approval body. Owner = accountable. Stakeholders = affected. Change advisory board = decides. Technicians = carry it out.

:::check q-1.3-003

## What a change needs before it goes live

Five items turn a risky idea into a controlled change. Each answers a different question.

| Term | Question it answers | Example line in a change record |
| --- | --- | --- |
| **Impact analysis** | What does this touch, and what could go wrong? | "340 users affected; the scanning service relies on this server; risk medium" |
| **Test results** | What happened when we tried it somewhere safe? | "All 28 checks passed in the test environment" |
| **Backout plan** | How do we undo it if it fails? | "If logins fail at 04:00, restore the pre-change snapshot" |
| **Maintenance window** | When may we do it? | "Sunday, 02:00 to 05:00" |
| **Standard operating procedure** | What are the exact steps we always follow? | "Follow SOP-14, monthly server patching" |

**Impact analysis.** Before deciding, find out what the change will affect: which systems, which users, which other services. Estimate what happens if it goes wrong, and compare that with the risk of *not* making the change. Leaving a known vulnerability unpatched is also a risk. A security-minded impact analysis also asks whether the change weakens any control, even for a short time.

**Test results.** The change is tried in a test environment that resembles production, and the outcome is written down. Test results are evidence, and the approvers expect to see them before they decide. They should show that the change works and that it has not broken anything else, including security settings. An upgrade that installs cleanly but switches an insecure protocol back on has not passed.

**Backout plan.** A backout plan is the documented way to return a system to its previous working state if the change fails. It needs three things: something to go back to (a backup, snapshot or saved configuration taken just before the change), written steps for restoring it, and a decision point ("if X is not working by 04:00, we back out"). A backout plan that nobody has tried is a hope, not a plan.

**Maintenance window.** A maintenance window is an agreed period during which the change may be made. It is proposed in the change request and approved along with the change. It is chosen to disturb the business as little as possible, so it is often at night or on the weekend, and stakeholders are told about it in advance. An online store might also ban non-urgent changes entirely in its busiest weeks.

**Standard operating procedure.** A standard operating procedure (SOP) is a written, step-by-step instruction for a routine task, so that the task is done the same way whoever does it. The change management process itself is written down as a procedure, and routine changes such as monthly patching are carried out by following one. Doing the work from the SOP rather than from memory is what stops a step such as "re-enable logging" from being forgotten.

> **Common trap:** A backout plan and a maintenance window are not the same thing. The window says *when* you are allowed to work. The backout plan says *how* you get back if the work fails. The two are linked: the backout must be finished before the window closes, so the decision to back out has to be made while there is still time to do it.

:::check q-1.3-007

## Technical implications: allow lists, deny lists and restricted activities

A change that is approved on paper still has to work on real systems. The objective lists several technical points to consider. The first two concern what is permitted.

**Allow lists and deny lists** are two opposite ways to control what may run, connect or pass.

| Aspect | Allow list | Deny list |
| --- | --- | --- |
| Rule | Only what is on the list is permitted | Everything is permitted except what is on the list |
| Something new and unknown | Blocked | Permitted |
| Strength | Stricter: stops threats nobody has seen before | Looser: stops only what is already known to be bad |
| Cost | More upkeep; a missing entry blocks legitimate work | Less upkeep; a missing entry lets something bad through |

The lists appear in many places: applications allowed to run on a workstation, IP addresses allowed through a firewall, domains a mail gateway accepts.

They matter for change management because a change often does not work until a list is updated, and every edit to a list is itself a change to a security control:

- On workstations with an application allow list, a new or updated program may be blocked until its entry is added. The list update belongs in the change plan.
- A new server may need new firewall entries. Each entry should be as narrow as possible, because an entry that is too broad is a hole.
- When a system is retired, its entries should be removed. An allow entry for a supplier you stopped using two years ago is still an open door.

**Restricted activities.** An approval is not general permission to work on a system. It covers a defined scope: these actions, on these systems, in this window. Work outside that scope is restricted: it may not be done on the strength of this approval. A technician approved to replace a certificate on a web server may not also "clean up" its other settings, even if the fix looks obvious and the window is still open. The extra work was never analyzed or tested and has no backout plan.

If something unexpected turns up during the work, the change process decides what happens next. Usually that means finishing or backing out the approved work and raising a new request for the rest. If extra work is needed to complete the approved change itself, the technician still does not decide alone: the process says who can authorize the wider scope, and that decision is recorded. You may also see the term used for limits placed on normal activity while a change is underway, such as making a database read-only during a migration. Both uses come down to the same rule: during a change, only what the approved plan allows is done.

:::check q-1.3-012

## Technical implications: downtime, restarts, legacy applications and dependencies

**Downtime** is any period when a service is unavailable to its users. Many changes cause some. Availability is a security goal, so downtime must be planned: estimate it in the impact analysis, place it in the maintenance window, tell the stakeholders, and keep it short. Where there are two of something, such as a pair of firewalls, you can often change one at a time and avoid downtime altogether.

Many changes only take effect after something is restarted. The exam names two kinds.

| Term | What happens | Who notices |
| --- | --- | --- |
| **Service restart** | One background service (a daemon, such as the DNS or web server service) is stopped and started so that it loads the change. The operating system and other services keep running. | Users of that service, briefly, and anything that relies on it |
| **Application restart** | A program is closed and opened again so that it loads its new version or settings. | People using that application, who may lose their session or unsaved work |
| **Downtime** | The service as a whole is unavailable. A full reboot of a server causes downtime for everything on it. | Everyone who uses the service |

A restart is also a moment of risk. A service may fail to start again. Settings that were applied but never saved can vanish. A security agent may not come back. Verifying a change therefore means checking that protections such as firewall rules and logging are running after the restart, not only that the application answers. The opposite mistake is just as common: a patched file often has no effect until the service that uses it has been restarted, so a server can look patched and still be vulnerable.

**Legacy applications.** A legacy application is an old application that the business still depends on but that is no longer actively developed or supported. Often the vendor has stopped supporting it or no longer exists, the people who built it have left, and little is written down. It may run only on an old operating system. Legacy applications raise the risk of change in two ways:

- A change near them, such as an operating system patch or a database upgrade, may break them, and nobody can be called to fix it.
- Fear of breaking them means the systems around them are left unpatched for years.

The answer is not to exempt them from change management. Document what is known, test changes on a copy first, and prepare a backout plan you trust. Where a legacy system truly cannot be updated, protect it another way, for example by isolating it on its own network segment.

**Dependencies.** A dependency exists when one component needs another in order to work: an application needs a certain database version, a web application cannot start until the database behind it is running, a patch can only be installed after an earlier one. Dependencies mean that a change to one thing is rarely a change to one thing. Upgrading a database can break the reporting tool that reads from it, and it may require the backup agent to be upgraded first. Finding dependencies is a main job of the impact analysis. They also decide the order of the work.

> **Exam tip:** When a scenario says a change to one component broke a different one, or that item A must be upgraded before item B, the term to look for is *dependencies*. When it stresses that the software is old, unsupported and poorly understood, the term is *legacy application*.

:::check q-1.3-016

## Documentation and version control

A change is not finished when the system works. It is finished when the records match the system.

**Updating diagrams.** Network diagrams, data flow diagrams and similar drawings show how systems connect. After a change that moves a server, adds a network segment or alters a firewall, the diagrams must be updated. Out-of-date diagrams cost time when it matters most: incident responders trace an alert to a server that is no longer where the diagram says, or defend a network path that no longer exists while the real one goes unwatched.

**Updating policies/procedures.** If a change alters how work is done, the written policies and procedures must change with it. Replace the backup system and the restore procedure has to be rewritten. Otherwise, the next person to follow it at 03:00 during an outage will be following instructions for equipment that is gone. The change record itself, with its approvals, test results and outcome, is also kept. It is the audit trail that shows what was done and who agreed to it.

**Version control** is the practice of tracking every version of a file over time: who changed what, when and why. It is best known for source code, but it serves equally well for router configurations, firewall rule sets, scripts and server build files. For security it provides three things:

- **A history.** Every modification is attributed to a person and a reason, which makes changes auditable.
- **A way back.** Any earlier version can be restored, which makes changes reversible and gives the backout plan something reliable to return to.
- **A reference.** Comparing a live system with the latest approved version shows at once whether anything has been changed outside the process, whether by a hurried administrator or by an attacker.

Version control also covers the versions of the software itself. Knowing exactly which version of an application or operating system is installed where tells you which systems a newly announced vulnerability affects.

Together, documentation and version control are what make the rest of the process worth doing. Testing and approval reduce the chance that a change goes wrong. Records and versions make sure that, when one does, you can see what happened and fix it.

:::check q-1.3-023
