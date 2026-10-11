# Incident response

Commercial V1 directive Part 9 section 11. Read this page first; the scenario pages next to
it (listed at the end) give the steps for each kind of incident.

## Who is responsible

| Role | Person | Status |
|---|---|---|
| Primary incident owner | Not appointed | **BLOCKED** |
| Backup incident owner | Not appointed | **BLOCKED** |
| Legal reviewer for any notification | Not appointed | **BLOCKED** |

No name, phone number or email address is written in this repository. The people and the
way to reach each of them are kept in a roster outside the repository, in a place only
those people and the platform owner can open. This table records only whether each role is
filled.

**Launch gate.** Commercial launch is BLOCKED until the primary and backup owners are
appointed by a person with authority to do so, have each accepted in writing, and the
outside roster says how to reach both. Until then, do not set
`COMMERCIAL_READINESS_ATTEST_INCIDENT_OWNER=true`; leaving it unset keeps the readiness check
in commercial mode failing, which is the intended effect. A name typed into this table does
not satisfy the gate; the acceptance does.

**Until then (controlled pilot, made-up data only).** Whoever holds the `PLATFORM_OWNER`
role acts as incident lead by default. That is a stop-gap for a pilot that must hold no real
personal data, not an arrangement for real users.

## What we promise about response time

Nothing. There is no 24/7 cover and no on-call rota. During the pilot an incident is handled
on a best-effort basis by the people above. Do not tell a user, an agency or a regulator that
anyone is available around the clock, and do not write a response time into any agreement,
until a rota exists and has been staffed.

## Severity

| Level | Meaning | Examples |
|---|---|---|
| SEV1 | Personal data or documents may have reached someone who should not have them, or data has been lost, or the core service is down | A leaked database credential with evidence it was used; a staff account taken over and used to open other people's files; the database or storage gone |
| SEV2 | A security control has stopped working, or a secret may be exposed with no sign of use, or a critical flow is down | The virus scanner is down and uploads wait; the audit trail shows a broken link; sign-in fails for everyone; a key was pasted into a public place |
| SEV3 | Something important is degraded but nobody's data is at risk | Email is late or bouncing; AI suggestions are off; notifications are backing up |
| SEV4 | A near miss, a minor fault, or a question worth recording | A suspicious email that was not acted on; a dashboard reading that looks off |

When unsure between two levels, use the higher one and lower it later.

## The eight steps

Every scenario follows the same order. The scenario pages say how to do each step for that
case.

1. **Declare.** Write down the time, who noticed what, and give it a number
   (`INC-YYYYMMDD-n`). From here on keep a running log: time, what was seen or done, by whom.
   A log kept afterwards from memory is not evidence.
2. **Contain.** Stop it getting worse. Prefer switching something off or revoking it over
   deleting it, because deleting destroys what you need to understand what happened.
3. **Revoke.** Take away access that may be misused: sessions, roles, invitations, shares, keys.
4. **Preserve evidence.** Before anything is cleaned up or restored (rules below).
5. **Assess.** Work out what was reached, whose data, over what period, and whether it is
   still happening. Say plainly what is known and what is not.
6. **Notify and escalate.** Only after the legal reviewer has looked (rules below).
7. **Recover.** Put things right, in the order that keeps people safe first.
8. **Postmortem.** Within five working days of closing. What happened, why, what changes.

## Preserving evidence

Do this before cleanup or restore, in this order, and write each action in the log.

1. **Database.** In the Neon console, create a branch from the production branch and name it
   `evidence-INC-...`. It freezes the data as it stands. Never overwrite or reset production
   to do this.
2. **Application log.** The Vercel runtime log is kept for a short, plan-dependent time.
   Export the window around the incident now (search for the event names in
   `monitoring.md`).
3. **Sign-in record.** From the WorkOS dashboard, export the user's events and sessions for the
   accounts involved.
4. **Audit trail.** Export the rows of `audit_events` for the period (queries are on the
   scenario pages). Do not attempt to repair, edit or re-chain the audit trail. If its chain
   does not verify, that is part of the incident.
5. **Pipeline and code.** GitHub Actions logs of any deploy or migration in the window, and
   the exact commit that was live (Vercel deployment details).
6. **Fingerprint what you saved.** Compute a SHA-256 of every exported file and write the
   hashes in the log. Keep the files in the restricted place, not in the repository, a chat or
   an email.
7. **Set an expiry.** Evidence that holds personal data must not outlive its purpose. Write a
   review date in the log, and delete the evidence branch and exports when it passes, unless a
   legal hold applies. The directive's target for backups to expire is 90 days; do not keep
   evidence copies longer than that without a recorded reason.

Audit checkpoints (signed anchors over the audit trail) exist as code but are **not scheduled
and not used anywhere yet**, so there is no outside copy of the trail to compare against. The
export in step 4 is the only independent copy; treat it as precious.

## Telling people (legally reviewed)

- Nothing goes to an affected person, an agency, a regulator, a partner, the press or the
  public until the legal reviewer has read the exact text. Not even "we are looking into it" if
  it names data or causes.
- The incident owner decides who is told and when; the legal reviewer decides the wording and
  whether a legal duty to notify exists in each person's country (Bangladesh, Singapore and
  anywhere else an affected person lives). This page does not say what the law requires.
- Say what is known, what is not known and what people should do. Do not speculate about the
  cause, the attacker or the number of people. Do not promise outcomes.
- A notice has to be useful: what happened, which kinds of data, when, what you have done, what
  they should do, and how to reach a person.
- Record in the log who approved each message and when it was sent.

## Escalation

| When | Who |
|---|---|
| Any SEV1 or SEV2 | Primary incident owner, then backup if no reply in 30 minutes |
| Data may have been exposed | Legal reviewer, before anything is said outside |
| A provider is at fault | The provider's support channel, from the account that holds the contract |
| The people above cannot be reached | The platform owner decides; record that the roster failed |

## Where things are

| Need | Where |
|---|---|
| Is the service up and ready | `GET /api/health/ready`; `/app/admin` Operations, "Operational signals" and "Platform readiness detail" |
| What happened inside the product | `/app/admin/audit` (newest 50 only); the database table `audit_events` for anything more |
| Roles, pilot invitations | `/app/admin/access` |
| Organizations (suspend, terminate) | `/app/admin/organizations` |
| Legal holds, erasure jobs | `/app/admin/privacy` |
| AI switches and keys | `/app/admin/ai-settings` |
| Sign-in sessions, users, MFA | WorkOS dashboard |
| Environment variables, deployments, rollbacks, logs | Vercel dashboard |
| Database, branches, restore | Neon console |
| Migrations, scans, deploy checks | GitHub, Actions tab |

## The scenarios

| Scenario | Page |
|---|---|
| An account or session is taken over | [access-compromise.md](./access-compromise.md) |
| A secret or key leaks or may have leaked | [secret-compromise.md](./secret-compromise.md) |
| The virus scanner is down, missing or wrong | [scanner-outage.md](./scanner-outage.md) |
| Object storage fails or files go missing | [storage-issue.md](./storage-issue.md) |
| An AI provider fails, misbehaves or costs too much | [ai-provider-issue.md](./ai-provider-issue.md) |
| Email or notifications fail | [email-notification-issue.md](./email-notification-issue.md) |
| Personal data may have been exposed | [data-exposure.md](./data-exposure.md) |
| The database or data must be restored | [restore.md](./restore.md) |

Practice: [tabletop.md](./tabletop.md) holds a scenario to run with the people above, and the
desk check that has been done so far.

## After any incident

Write the postmortem in the same place as the log. Keep it free of blame. It states:
the summary in two sentences; the timeline; who and what was affected; how it was found and
how long that took; the cause; what worked and what did not; and the changes to make, each with
an owner and a date. If a runbook was wrong or missing a step, change it in the same week and
say which incident taught you.


## Current operating correction (2026-10-11)

Neon Auth is configured for production; legacy WorkOS references do not authorize email-only record linking or claim current staff MFA acceptance.

Earlier implementation snapshots and provider-specific instructions above are retained as history. For current setup, incident response and availability, use [current operating guidance](../current-platform.md). Original acceptance and security targets remain in force; this correction does not mark them complete or authorize migration, production restore, paid activation or sensitive-data intake.
