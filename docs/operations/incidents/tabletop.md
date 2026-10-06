# Tabletop practice

Commercial V1 directive Part 9 section 11. Two parts: the desk check that has been done, and a
scenario script to run with people.

**No tabletop with people has been run.** Nobody has walked through these runbooks out loud, timed
a step, or found out whether the people named in the roster can be reached. The desk check below
was done by one reader comparing each runbook step with the code and the pages. It shows that the
named controls exist. It does not show that the steps work under stress, or that a person can do
them in the time an incident allows.

## Part 1: desk check (2026-10-06)

Method: for each step the runbooks rely on, find the control, page, job or command it names, and
say how it was confirmed. "Found in code" means the name was searched for in the repository and
the file that holds it was identified. It does not mean the control was run.

| Runbook step | Control it relies on | How checked | Result |
|---|---|---|---|
| Keep a running log with an incident number | A document kept outside the repository | Nothing to check; a habit, not a control | GAP: no log template or place exists yet. The owner picks the place |
| End every session for a person | WorkOS dashboard, Users, Sessions (`revokeUserSessions`) | Outside this repository; not reachable from here | NOT VERIFIED. Needs a person with WorkOS admin access to try it on a test user |
| Revoke a person's invitation | `/app/admin/access`, "Pilot access" | Page exists in `apps/web/src/app/app/admin/access`; the sign-in check `checkPilotAccess` is in `apps/web/src/lib/pilot-access.ts` | Found in code. Not run |
| Remove an address from the allow list | `PILOT_ALLOWLIST_EMAILS` in Vercel, then redeploy | Variable is read by the pilot access check | Found in code. The redeploy time is not measured |
| Reset a second factor | WorkOS (`resetUserAuthenticationFactors`) | Outside this repository | NOT VERIFIED. Staff MFA is also not enforced (known gap) |
| Switch an agency member off | Agency Team page | Page exists | Found in code. Not run |
| End a support grant | Support grants (`SUPPORT_GRANT_CREATED`, `GRANT_REVOKED` events) | Both event names found in `packages/services/src/support-access.ts` and `sharing.ts` | Found in code. Not run |
| Read who did what | `/app/admin/audit`, the audit events table | Page exists. The chain check `checkRecentAuditChain` is in `packages/services/src/audit.ts` | Found in code |
| Check the whole audit trail is intact | `pnpm --filter @visastack/adapters verify:audit-chain` | New tests drive it against a throwaway database: intact trail gives exit 0, an edited event and a removed event give exit 1 | Verified against a test database. Never run against the real database |
| See whether the audit trail can be altered | Database rules refuse edits and deletes | Rules named in migration `0000`; the tests drop them to simulate privileged access | Verified in the test database. Someone with database owner rights could still drop them, which is why the chain check exists |
| Roles that can act (platform owner, security admin, support admin, compliance admin) | `platform-roles.ts` and its event `PLATFORM_ROLE_GRANTED` | Found in code with its own tests | Found in code |
| Look at the scanner state | Admin Operations page signals; scan results table | Signals exist; the scanner-outage page lists the ones it relies on | Found in code. A live scanner outage was never simulated |
| Retry stuck notifications | `retryNotification` in `packages/services/src/notifications.ts`; admin Operations page | Found in code | Found in code. Not run |
| Notification worker and date checks keep running | Daily scheduled jobs in `apps/web/vercel.json` (03:40 and 03:50 UTC) | Read the file | Runs once a day only. The email runbook must not promise faster. Requirement NTF-04 corrected |
| Clean up abandoned uploads | Daily job `process-abandoned-uploads`; event `abandoned_upload_cleaned` | Found in code | Found in code |
| Turn the AI features off | `AI_ENABLED` and the admin AI settings page | Both found | Found in code. Not run |
| Cap AI spend | `AI_PILOT_MONTHLY_HARD_LIMIT_USD`, `AI_PER_DOCUMENT_LIMIT_USD` | Found in `.env.example` and the settings code | Found in code |
| Switch email off | `EMAIL_PROVIDER` | Found in `.env.example` | Found in code |
| Check email delivery events | `/api/webhooks/resend` with `RESEND_WEBHOOK_SECRET` | Route exists | Found in code. Needs a live check once email is on |
| Replace a leaked secret | Vercel environment, GitHub secrets, provider consoles | Outside this repository | NOT VERIFIED. No rotation tool exists for the master key (known gap) |
| Find a leaked secret in history | A secret scan on pull requests | None runs on this private repository | GAP: planned in the supply-chain task |
| Export one person's data for a request | Account export (`ACCOUNT_EXPORTED`) | Found in `packages/services/src/export.ts` | Found in code |
| Prove a deletion finished | Erasure verification (`ERASURE_VERIFIED`) | Found in code with tests | Found in code |
| Restore the database | Neon history branch, then `reconcile-restored-branch` and `verify:audit-chain` | Procedure in `docs/operations/recovery.md` | NOT TESTED. No restore has been rehearsed |
| Restore document files | A separate copy of the originals | None exists | GAP: no independent copy of document files, no escrow of the master key |
| Roll back a release | Vercel instant rollback, the release record | Documented in `release-and-rollback.md` | NOT TESTED. A rollback was never rehearsed |
| Notify people affected | Legally reviewed template, a named legal reviewer | No reviewer is appointed | GAP: BLOCKED until a legal reviewer is appointed |
| Reach the incident owner and backup | Outside roster | No one is appointed | GAP: BLOCKED. Launch is blocked until both accept in writing |

Summary of the desk check: 2 steps verified against a test database (the audit chain check and the
edit and delete protection); 14 steps found in code but never run; 3 steps outside the repository
that cannot be checked from here; 2 procedures documented but not tested (database restore,
rollback); 5 gaps that need a person or a purchase (no log place, no secret scan, no independent
copy of document files, no legal reviewer, no incident owners); 1 timing limit (notification and
date checks run once a day). None of these was fixed by this exercise; each is listed with its
owner in the report.

## Part 2: scenario script to run with people

Run this with the primary owner, the backup owner and the legal reviewer once they are appointed.
Use the pilot with made-up data only. Allow 90 minutes. Someone who is not a responder keeps time
and writes down what was said, not what was meant.

**Scenario.** A pilot agency staff member tells you they got a sign-in alert they did not cause. The
audit page shows that account opened six applicants' documents in the last hour, at night, from a
place the staff member says they have never been.

Walk through, in this order, and record the minutes taken and who did each step:

1. Who declares the incident, and where is the log kept? Start the log.
2. Decide the severity with the table in the README. Say why.
3. End the account's sessions and shut the door. Do it on a test user in the real WorkOS and the
   real admin page. Time it.
4. Preserve evidence. Which pages, exports and screenshots do you save, and where?
5. Assess. Using only the audit page, list which applicants' documents were opened and when.
6. Decide who must be told. The legal reviewer says what the notice must and must not say.
   Draft it in ten minutes.
7. Inject a twist at minute 45: the same address appears on a second agency account. What changes?
8. Inject a second twist at minute 60: the person holding the WorkOS admin login is unreachable.
   Who can do step 3 now?
9. Close: what would the postmortem say? Which runbook line was wrong or missing?

Record: the time each step took, each place the runbook was wrong or unclear, each person who
could not be reached, and each tool that was not available. Fix the runbooks within a week and
change the desk-check table above to say what was found. Only then may the line "no tabletop has
been run" be changed, and only to give the date, the people present and what they found.
