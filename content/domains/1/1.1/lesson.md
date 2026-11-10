---
objective: "1.1"
title: "Security controls: categories and types"
minutes: 14
---

## What a security control is

A **security control** is any measure an organization puts in place to reduce risk to its systems, data, people or buildings. A firewall rule is a control. So are a locked door, a written policy and a training session.

The exam expects you to describe any control in two separate ways:

- **Category**: how the control is implemented. Who or what makes it work? There are four categories: technical, managerial, operational and physical.
- **Control type**: what the control does about an incident. There are six types: preventive, deterrent, detective, corrective, compensating and directive.

The two labels are independent. Knowing that a control is technical tells you nothing about whether it is preventive or detective. A full description uses both: a firewall rule that blocks a port is a *technical, preventive* control.

Organizations use a mix of categories and types on purpose. This is called **defense in depth**: several layers of controls, so that one failure does not leave an asset exposed. A locked server room does not help against a stolen password, and a strong password does not help against someone carrying the server out of the door.

:::check q-1.1-001

## The four control categories

To find the category, ask: **who or what makes this control work?**

| Category | Implemented by | Examples |
| --- | --- | --- |
| **Technical** | Hardware, software or firmware | Firewall rules, disk encryption, antivirus, file permissions, multifactor authentication (MFA: a login that needs two or more kinds of proof) |
| **Managerial** | Management's oversight of risk | Risk assessments, security policies, security reviews of suppliers, security planning |
| **Operational** | People carrying out day-to-day tasks | Security awareness training, exercises in spotting suspicious email |
| **Physical** | Tangible barriers and devices that protect buildings and equipment | Fences, door locks, bollards, lighting, cable locks |

Two older names still appear in study material. Technical controls are sometimes called *logical* controls, and managerial controls are sometimes called *administrative* controls.

The pair that learners mix up most is managerial and operational. Managerial controls decide and document: which risks exist, what the rules are, who is responsible. Operational controls are people doing the work. The policy that says every new employee must be trained is managerial. The trainer running the session is operational.

Some controls sit on a border. A security guard is a person carrying out a duty (operational) whose job is to protect a building (physical), and sources place guards in either category. A fair question describes what matters in the scenario or offers only one of the two.

> **Exam tip:** Use one quick test per category. A system enforces it: technical. Management decided or documented it: managerial. People have to carry it out: operational. It is a tangible barrier or device protecting a place: physical.

:::check q-1.1-002

## Control types that act before or during an incident

To find the control type, ask: **what does this control do about an incident?** Three of the six types act before an incident or while it is happening.

- **Preventive**: stops the unwanted action from succeeding. A firewall rule drops the traffic. A door lock keeps the door shut. Disk encryption stops a thief from reading the data on a stolen laptop.
- **Deterrent**: discourages someone from trying. It works on the person's decision and does not block anything. Examples are a "Trespassers will be prosecuted" sign and a login message warning that misuse will be reported to the police.
- **Detective**: identifies and reports an incident during or after it, without stopping it. Examples are log reviews, audits, motion sensors and an **intrusion detection system (IDS)**, which watches network traffic or a host and raises alerts.

| Test | Preventive | Deterrent | Detective |
| --- | --- | --- | --- |
| Does it block the action? | Yes | No | No |
| Does it tell you something happened? | Not necessarily | No | Yes |
| Does it depend on the attacker knowing about it? | No | Yes | No |

One pair of devices shows the difference well. An IDS only alerts, so it is detective. An **intrusion prevention system (IPS)** sits in the path of the traffic and drops what it judges to be an attack, so it is preventive.

> **Exam tip:** A deterrent only works if the attacker knows it is there. A hidden camera deters nobody, and a warning sign detects nothing.

:::check q-1.1-004

## Control types that repair, substitute or instruct

The other three types do different jobs.

- **Corrective**: acts after an incident to limit the damage and return things to normal. Examples are restoring files from backup, rebuilding an infected PC from a clean image, and a fire suppression system putting out a fire.
- **Compensating**: an alternative control used when the normal, required control cannot be put in place. If a machine cannot be patched, isolating it on its own network segment is a compensating control. The last section of this lesson covers when this is appropriate.
- **Directive**: tells people what they must or must not do, and relies on them to comply. Examples are policies, procedures and instruction signs. An **acceptable use policy (AUP)**, the rules for how staff may use the organization's systems, is a directive control.

Directive and deterrent controls look alike because both are often just words on a sign or a screen. Read the wording.

| | Directive | Deterrent |
| --- | --- | --- |
| What it says | "Do this" or "Do not do this" | "If you do this, there will be consequences" |
| Example sign | "All visitors must sign in at reception" | "Trespassers will be prosecuted" |
| Example on a system | A policy that states which software staff may install | A login message warning that misuse leads to dismissal |

Some frameworks list *recovery* as a separate control type. The SY0-701 objectives do not. On this exam, restoring normal operation after an incident is corrective.

> **Common trap:** A backup is not preventive. Taking a backup does not stop ransomware or notice it. The backup does its job after the incident, when you restore from it, so it is a corrective control.

:::check q-1.1-006

## Combining category and type

Every control can be given one label from each list. Four categories and six types give 24 combinations, and a real organization has controls in most of them.

:::diagram control-types-matrix

Classify in two passes:

1. **Who or what makes it work?** That gives the category.
2. **What does it do about an incident?** That gives the type.

| Control | Pass 1: category | Pass 2: type |
| --- | --- | --- |
| A firewall rule that blocks inbound Remote Desktop | Technical | Preventive |
| An IDS that alerts on suspicious traffic | Technical | Detective |
| Endpoint software that rolls files back after ransomware changes them | Technical | Corrective |
| An acceptable use policy issued by management | Managerial | Directive |
| Help-desk staff calling a user back on a known number before resetting a password | Operational | Preventive |
| A deadbolt on the server room door | Physical | Preventive |
| A "Trespassers will be prosecuted" sign on the fence | Physical | Deterrent |
| A motion sensor that sounds an alarm | Physical | Detective |

Answer options on the exam often change only one of the two labels, for example "technical, detective" next to "technical, preventive". Decide each label separately and then find the option that has both.

:::check q-1.1-008

## One control, more than one possible type

Many real controls can do more than one job. A camera is the standard example:

- A camera in plain view discourages a thief. That is a deterrent job.
- Recorded footage that someone reviews after a theft shows who did it. That is a detective job.
- A fake camera with nothing behind it can only deter.
- A hidden camera can only detect.

A fence both blocks entry and discourages people from trying. An IPS that is switched to alert-only mode stops being preventive and becomes detective.

So the rule is: **classify a control by what it is doing in the scenario**, not by its name. Exam scenarios include a clue that points to one job.

| Clue in the scenario | Control type |
| --- | --- |
| "blocks", "stops", "does not allow" | Preventive |
| "discourages", "warns of prosecution" | Deterrent |
| "alerts", "logs", "identifies who", "reviews" | Detective |
| "restores", "repairs", "removes after the infection" | Corrective |
| "cannot be patched, so instead", "in place of the required control" | Compensating |
| "requires staff to", "instructs", "states that users must" | Directive |

> **Common trap:** Do not answer from the name of the device alone. "Camera" is not automatically detective and "sign" is not automatically deterrent. Find the words in the scenario that say what the control is there to do.

:::check q-1.1-010

## When a compensating control is appropriate

Sometimes the control that a policy, standard or regulation requires cannot be put in place. A compensating control is the approved alternative. It is appropriate when all of these are true:

1. A specific control is required or expected.
2. It cannot be implemented as specified, for a real reason: a technical limit, or a business constraint such as a system that cannot be taken offline.
3. The alternative reduces the *same risk* to a similar level.
4. The decision is documented and approved, and it is reviewed later. Many compensating controls are temporary.

| Required control | Why it cannot be used | Compensating control |
| --- | --- | --- |
| Security patches on every machine | A lab instrument runs on an old operating system that the vendor will not update | Put the machine on an isolated network segment and monitor its traffic |
| MFA for every administrator login | A legacy server cannot support MFA | Allow administrator logins only through a gateway server that does require MFA, and log each session |
| Separation of duties (splitting a sensitive task so that no one person can complete it alone) | A two-person finance team is too small to split payment entry from approval | The owner checks the bank statement against invoices every week |

A compensating control is not any of these:

- An extra layer on top of a required control that is already working. That is defense in depth.
- A decision to do nothing and accept the risk.
- A fix. The weakness is still there; the old operating system is still unpatched.

The alternative does not have to be in the same category as the control it replaces. In the finance example, an operational review stands in for a rule that would normally be built into the payment system.

> **Exam tip:** "Compensating" describes why a control is there. When a scenario says that the normal control cannot be used and something else is used in its place, choose compensating, whatever the substitute happens to be.

:::check q-1.1-012
