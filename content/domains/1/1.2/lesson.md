---
objective: "1.2"
title: Fundamental security concepts
minutes: 20
---

## The CIA triad

Every security control protects at least one of three goals. Together they are called the **CIA triad**: Confidentiality, Integrity, and Availability.

- **Confidentiality** means only authorized people and systems can read the information. A payroll file that the whole company can open has lost confidentiality, even if nobody changed it.
- **Integrity** means the information is accurate and has been changed only by people who are allowed to change it. If someone alters the bank account number on an invoice, the invoice has lost integrity, even if it was never secret.
- **Availability** means systems and data can be reached when authorized users need them. A booking site knocked offline by a flood of junk traffic has lost availability, even though no data was read or changed.

| Goal | Typical attacks | Typical controls |
| --- | --- | --- |
| Confidentiality | Eavesdropping on network traffic, stealing a laptop | Encryption (scrambling data so that only someone with the key can read it), access permissions |
| Integrity | Changing a file or record without permission | Hashing (a short fingerprint of a file that changes if the file changes), digital signatures |
| Availability | Denial-of-service (DoS) attack that floods a service with traffic, hardware failure | Redundant hardware, backups, patching |

:::diagram cia-triad

The three goals pull against each other. A server that is unplugged and locked in a safe is very confidential and not available at all. Security work is choosing the right balance for each system: a public website needs availability and integrity far more than confidentiality, while a salary database needs all three.

> **Exam tip:** In a scenario, ask what was actually harmed. Read by the wrong person is confidentiality. Changed without permission is integrity. Not reachable when needed is availability.

:::check q-1.2-001

## Non-repudiation

To repudiate something is to deny it. **Non-repudiation** means a person cannot credibly deny an action they took, such as sending a message or approving a payment, because there is proof that only they could have produced.

The everyday version is signing for a parcel. The digital version is a **digital signature**. The sender's software creates the signature with the sender's **private key**, a secret that only the sender holds. Anyone can check the signature with the matching public key. A valid signature shows two things: the message has not changed since it was signed (integrity), and it was signed with that sender's private key (proof of origin). Because nobody else has the key, the sender cannot deny signing. Objective 1.4 explains how signatures work.

Non-repudiation is easy to confuse with two neighbors:

| Concept | Question it answers | Example |
| --- | --- | --- |
| Integrity | Has this data been changed? | The hash of a download matches the hash the vendor published |
| Authentication | Is this person or device who it claims to be, right now? | A user signs in with a password and a fingerprint |
| Non-repudiation | Can we prove afterwards who did this, even if they deny it? | A purchase order carries the manager's digital signature |

Non-repudiation also depends on individual accounts. If three administrators share one "netadmin" account and a firewall rule is deleted, the log shows only that netadmin did it. Each administrator can deny it, and nobody can prove otherwise.

> **Common trap:** A matching hash does not give non-repudiation. Anyone can calculate a hash, so it proves the file is unchanged but says nothing about who made it. Non-repudiation needs something only one party could have produced, such as a digital signature.

:::check q-1.2-003

## AAA: identification and authentication

**AAA** stands for Authentication, Authorization, and Accounting. It is the framework for controlling access to a network or system. In practice one more step comes first, so the full sequence has four steps:

1. **Identification**: you claim an identity, for example by typing a username. A claim proves nothing.
2. **Authentication**: you prove the claim.
3. **Authorization**: the system decides what the proven identity is allowed to do.
4. **Accounting**: the system records what was done, such as sign-in time, resources used and sign-out time.

A central AAA server often handles these steps for VPN and Wi-Fi sign-ins. RADIUS (Remote Authentication Dial-In User Service) is a common example.

### Authenticating people

People prove who they are with **authentication factors**: something you know (password, PIN), something you have (smart card, phone app, hardware token) and something you are (fingerprint, face). **Multifactor authentication (MFA)** uses two or more *different* factors. A password plus a PIN is one factor used twice, not MFA.

### Authenticating systems

Devices and services have to prove their identity too: a laptop joining the office Wi-Fi, or one server calling another. A device cannot type a password or scan a finger, so the usual answer is a **digital certificate**. This is a file that names the device and is digitally signed by a **certificate authority (CA)**, a server the organization trusts to issue certificates.

The company's CA issues a certificate to each managed device. When the device connects, it presents the certificate and proves that it holds the matching private key. The network checks that the certificate was signed by the trusted CA and has not been revoked (cancelled).

This lets the network accept a company laptop and refuse a personal phone, even when the same employee is using both with the same password. And because each device has its own certificate, a stolen device can be shut out by revoking that one certificate.

:::diagram aaa-flow

> **Exam tip:** People authenticate with factors; systems usually authenticate with certificates. If a scenario says "only company-managed devices may connect," look for a device certificate, not a stronger password.

:::check q-1.2-006

## AAA: authorization models and accounting

After authentication comes authorization: what may this user or device do? Assigning permissions one user and one resource at a time does not scale. In a hospital with 900 staff it leads to mistakes and to old permissions that nobody removes.

An **authorization model** puts a layer between users and resources, so that access follows a consistent method instead of being set by hand.

| Model | What decides access | Example |
| --- | --- | --- |
| Role-based | The user's job role; permissions belong to the role | Everyone in the Pharmacist role can open the dispensing system |
| Attribute-based | A combination of attributes of the user, device, resource and context | A project member, on a managed laptop, during working hours |
| Rule-based | System-wide rules set by an administrator that apply to everyone | Nobody can sign in to the payroll application between 22:00 and 06:00 |
| Mandatory | Labels set centrally; the user's clearance must match the data's label | Only users cleared for "Secret" can open files labeled Secret |
| Discretionary | The owner of each resource | A user shares a folder they own with a colleague |

Objective 4.6 returns to these in detail. For now, know why a model is used and the one-line idea behind each. Whatever the model, the goal is **least privilege**: each user and device gets only the access its job needs.

**Accounting** is the record of what happened: who signed in, from where, when, what they accessed and how much data they transferred. These records are used to investigate incidents, to spot unusual behavior and sometimes for billing. When every person has their own account, accounting records also support non-repudiation.

:::check q-1.2-011

## Gap analysis

A **gap analysis** compares where your security is today with where it should be, and lists the differences. Those differences are the gaps.

It needs two things:

- **A target (baseline).** This is usually a recognized standard or framework, such as ISO/IEC 27001 or the NIST Cybersecurity Framework. It can also be a regulation or the organization's own policies.
- **An honest picture of the current state.** This covers people (staffing, training), processes (policies, procedures) and technology (the controls actually in place).

The work follows a simple order:

1. Choose the target.
2. Assess the current state against each requirement of the target.
3. Record each requirement that is not met.
4. Rank the gaps and plan how to close them. The final report gives recommendations, with priorities, costs and timescales.

Example: Northfield Credit Union must meet a payment card standard that requires MFA for all administrator access. The team finds MFA on the VPN but not on direct server logins. That is a gap. The report records it, rates its severity and recommends a fix.

A gap analysis is not a technical test. A vulnerability scan looks for known flaws on individual systems, and a penetration test tries to break in. A gap analysis looks at the whole security program against a standard, mostly through documents, interviews and configuration reviews.

> **Exam tip:** The phrases "current state versus desired state" and "compare against a framework or baseline" point to gap analysis.

:::check q-1.2-013

## Zero Trust: the idea and the data plane

Traditional networks trust location. Outside the firewall is untrusted; inside is trusted. Once attackers get inside, with a stolen VPN password or an infected laptop, they can move around freely.

**Zero Trust** removes that assumption. No user or device is trusted because of where it is on the network. Every request to every resource is authenticated and authorized, and trust is re-checked during the session.

A Zero Trust architecture is described in two planes:

- The **data plane** carries the actual traffic: the user's request to an application and the application's reply.
- The **control plane** makes the decisions about that traffic and passes them on.

The data plane has three parts to know:

- **Subject/system.** The subject is whoever or whatever asks for access: a user, an application or a service. The system is the device being used. Both are checked. A valid user on an infected laptop can be refused.
- **Policy enforcement point (PEP).** The gatekeeper that sits in the traffic path between the subject and the resource. It allows, monitors and ends connections. It does not decide anything itself: it asks the control plane and enforces the answer.
- **Implicit trust zone.** The area behind a PEP, where traffic is not checked again. Everything inside it is trusted as far as the last check. It is like the departure lounge after airport security: once you are through, nobody checks you again at each shop. Zero Trust keeps these zones as small as possible, ideally one resource each, so that passing one checkpoint does not open everything.

> **Common trap:** Zero Trust does not mean nobody gets access. It means access is never assumed. Being "on the internal network" counts for nothing.

:::check q-1.2-015

## Zero Trust: the control plane

The control plane holds two components that work as a pair. The enforcement point from the previous section is included in the table for comparison.

| Component | Plane | Job | One word |
| --- | --- | --- | --- |
| Policy engine | Control | Decides whether to grant, deny or revoke access for each request, using the organization's policies and inputs such as identity, device health and threat information | Decides |
| Policy administrator | Control | Carries out the engine's decision: tells the PEP to open or close the session and issues any session credentials | Tells |
| Policy enforcement point | Data | Sits in the traffic path and allows or blocks the connection as instructed | Enforces |

Here is one request from start to finish. Dana, an accountant at Harbor Lane Logistics, opens the payroll application from her managed laptop.

1. Her request reaches the PEP, which holds it and passes the details to the control plane.
2. The policy engine evaluates the request against policy: who is asking, on what device, from where, for what.
3. The engine decides to allow it. The policy administrator tells the PEP to open a session to the payroll application only.
4. The PEP lets the traffic through and keeps watching.

If Dana's laptop later reports malware, the policy engine changes its decision, the policy administrator tells the PEP to close the session, and the PEP cuts it.

Three more ideas belong to the control plane:

- **Policy-driven access control.** Each request is decided by defined policies that combine identity, device and context. Network location is not what decides.
- **Adaptive identity.** The proof required depends on the context of the request: location, device, time of day, the person's relationship to the organization, and their normal behavior. A correct password from an unknown tablet abroad at 02:00 is not treated like the same password from the office. The system asks for stronger proof or refuses.
- **Threat scope reduction.** Limit the entry points an attacker can use and how far one compromise can spread. Least privilege, network segmentation (splitting the network into separately controlled parts) and small implicit trust zones all reduce the scope.

:::diagram zero-trust-planes

> **Exam tip:** The policy engine decides, the policy administrator tells, the policy enforcement point enforces. The first two are in the control plane; the enforcement point is in the data plane.

:::check q-1.2-019

## Physical security

An attacker who can touch a server can bypass most technical controls, so buildings and rooms need protection too. Physical controls work in layers, from the site boundary inwards.

| Control | What it does | Worth knowing |
| --- | --- | --- |
| Bollards | Short, sturdy posts that stop vehicles and let pedestrians through | Protect entrances from a vehicle being driven into them |
| Fencing | Encloses the perimeter; deters intruders and slows them down | Can be see-through or solid; height matters |
| Lighting | Removes dark areas where someone could approach unseen | Also lets guards and cameras see; avoid deep shadows and glare |
| Video surveillance | Cameras that are watched live or recorded, often called CCTV (closed-circuit television) | Mainly detects and provides evidence; visible cameras also deter |
| Security guard | A person who checks identification, handles visitors and responds to incidents | The only control with human judgment |
| Access badge | An ID card, usually with a photo and a chip that door readers can read | Every use is logged: who, which door, when. A lost badge can be disabled |
| Access control vestibule | A small room with two interlocking doors; the second opens only after the first has closed | Lets one verified person through at a time |

The access control vestibule exists to stop **tailgating**: an unauthorized person following an authorized one through a door before it closes. Older material calls the vestibule a mantrap.

### Sensors

Sensors detect an intruder and raise an alarm. The four types differ in what they sense.

| Sensor | How it detects | Typical use |
| --- | --- | --- |
| Infrared | Senses infrared radiation, which is heat. A passive infrared sensor notices a warm body moving across its view, in light or dark | Motion detectors in rooms and corridors |
| Pressure | Senses a change in weight or force on a surface | A mat under the floor that triggers when stepped on; a plate that triggers when an object is lifted |
| Microwave | Sends out microwave (radio) pulses and measures the reflections; movement changes them | Large areas such as warehouses. The signal passes through thin walls and glass, which can cause false alarms |
| Ultrasonic | Sends out sound waves above the range of human hearing and measures the reflections | Detecting movement inside a single room; the sound does not pass through walls |

> **Exam tip:** Match the sensor to what it senses: heat is infrared, weight is pressure, reflected radio waves are microwave, reflected sound waves are ultrasonic.

:::check q-1.2-023

## Deception and disruption technology

Deception technology plants decoys for attackers to find. The decoys have no business purpose, so legitimate users have no reason to touch them. Any interaction is a strong warning sign. Decoys also disrupt an attack: the time an attacker spends on a fake system is time not spent on a real one, and defenders can watch the attacker's methods.

| Decoy | What it is | Example |
| --- | --- | --- |
| Honeypot | A single decoy system made to look like a real, attractive target | A fake file server with an old operating system |
| Honeynet | A network of honeypots that imitates a real environment | Fake web server, database server and workstations connected together |
| Honeyfile | A bait file placed on a real system; opening it raises an alert | "passwords.xlsx" on the finance share |
| Honeytoken | A piece of fake data that is tracked: if it is used or turns up somewhere, data has been stolen | A made-up customer record, or fake login details that work nowhere |

Size is the difference between a honeypot and a honeynet: one decoy system or a network of them. A honeynet is more convincing and shows how attackers move from machine to machine.

> **Common trap:** A honeyfile is a whole bait file, and the alert comes when someone opens it. A honeytoken is an item of fake data, such as one record or one set of login details, and the alert comes when that data is used or appears outside the organization.

:::check q-1.2-028
