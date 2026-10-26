# ADR-0017: Per-case sharing exceptions for all-cases grants

- **Status:** Accepted
- **Date:** 2026-10-26
- **Deciders:** Owner (approved the plan on 2026-10-26: ask each time a case is made with Prepare Again, no answer means no, pending all-cases invitations are bound too, Allow This Case asks for a fresh sign-in only when the original sharing needed one, migration 0090 to run right after the merge); WP-V4 implementation
- **PRD/Spec link:** `docs/upgrades/upgrade.v1.2.execution.md` U02 (Prepare Again) and T09; `docs/architecture/permission-model.md` laws 5 and 9; ADR 0016 (format)

## Context

A grant with no case (`grants.mission_id IS NULL`) reaches every case of the person, including every case made later. Prepare Again (U02) will make new cases from old ones, so an agency or a person who was given "all cases" for an earlier trip would silently see the new one. The owner decided the person must be asked, for each recipient holding all-cases access, whether that recipient may see the new case, and that a "no" must hold everywhere the grant is checked.

Constraints:

- One rule for "does this all-cases grant cover this case", used by the policy engine and by every SQL list query. No hand-copied variants.
- Fail closed on every error, except one: application code goes live minutes before migration 0090 runs, so a missing table must not break sign-in, case lists or the agency console.
- The access ratchet baseline must not grow. New service functions take a gate proof.
- A recipient is never told about an exception or about the case it hides.

## Decision

1. **Storage.** New table `grant_case_exclusions` (migration 0090, additive only): one row says "this all-cases grant, or this pending all-cases invitation, does not cover this one case". Exactly one parent is set (check constraint); one row per parent and case (partial unique indexes). Composite foreign keys `(grant_id, applicant_id)`, `(sharing_invitation_id, applicant_id)` and `(mission_id, applicant_id)` reference new `(id, applicant_id)` unique pairs on `grants`, `sharing_invitations` and `missions`, so the database refuses a row that mixes two people. This composite-key pattern is new in the schema and is commented there and in the migration. The migration was generated with drizzle-kit and hand-ordered so the unique pairs exist before the keys that reference them. Removing an exception is a hard delete; the audit trail keeps the history. There is no down-migration.

2. **One rule, two forms.** `grantCoversMission(grant, missionId)` in `packages/policy` is the rule: a case-scoped grant reaches only its case; an all-cases grant reaches every case except its `excludedMissionIds`. `evaluateGrant` denies `scope_mismatch` on an excluded case. Its SQL form is `grantCoversCaseSql` in `packages/services/src/access/grant-scope.ts`; `grant-scope.test.ts` proves the two agree on every grant shape and case. `loadGrantsForPolicy` attaches each grant's exceptions through the single row mapping `toPolicyGrant`, so `requireAccess`, `orgGrantPermits` and everything built on them inherit the rule without edits: case pages, notes, tasks, appointments, evidence requests and their decisions, requirements, selected evidence, assignments, reviewer decisions, Application Memory and insights gates. The SQL paths use the fragment: the agency case list (and through it the visible-case list, the reassignment queue and Do Next), workspace search, the notification recipient check and the agency evidence request list. Bulk export now uses `toPolicyGrant` too.

3. **Documents keep their own scope.** Documents and profile details have no case. An exception hides only what belongs to the case: the case itself, its selected evidence links, requirements, evidence requests, notes, tasks, appointments, decisions and outputs. A document the grant covers stays visible to the recipient. The question shown to the person (Prepare Again, a later change) must say so in plain words; the Sharing page already does.

4. **Missing table.** A `to_regclass('public.grant_case_exclusions')` check runs before every read. When the table is missing, reads mean "no exceptions", which is exact because none can have been written. The check never raises, so an outer transaction is never aborted and concurrent queries on the same connection are never disturbed (a savepoint read, as in profile photos, would put a concurrent query on the same transaction at risk in the failure window). Any other failure, such as a renamed column, throws. Nothing is cached. The write side refuses while the table is missing (see 5), so a "no" is never lost.

5. **Write side** (`packages/services/src/sharing.ts`, owner only, each takes an `AuthorizedApplicant` proof):
   - `listCaseSharingQuestions` (VIEW_METADATA): every all-cases grant that is active, paused or awaiting acceptance and not expired, and every pending all-cases invitation, with a plain recipient label.
   - `applyCaseSharingAnswers` (MANAGE on the new case, in the transaction that creates it): every recipient not ticked is excluded, computed at apply time, so someone added after the question was shown is excluded too. A ticked id that is not one of this person's current all-cases grants or invitations is refused. Idempotent. Audits `GRANT_CASE_EXCLUDED` per "no" and `GRANT_CASE_ALLOWED` per "yes". While migration 0090 has not run and there is anyone to exclude it returns `upstream_error` (the codebase's existing "not available yet" code), and the caller must throw so the new case rolls back.
   - `removeCaseException` (MANAGE on the case, "Allow This Case"): deletes one exception and audits `GRANT_CASE_EXCLUSION_REMOVED`. Refused on a revoked or expired grant. Asks for a fresh sign-in, bound to SHARE on the person's record, only when the grant hands out a `STEP_UP_ACTIONS` action, the same rule as `createGrant`.
   - Nothing notifies a recipient.

6. **Invitations.** When a pending all-cases invitation with recorded exceptions is accepted, `acceptSharingInvitation` copies them onto the new grant and deletes the invitation-bound rows in the same transaction, before the grant becomes active.

7. **Transparency.** `listAccessForApplicant(Detailed)` returns `caseExceptions` per grant; the Sharing page shows "Not Shared: <case title>" under each live all-cases grant with an "Allow This Case" button that asks inside the page first. Application Memory returns `notSharedWith` per case (live grants only) and its page names them.

## Consequences

- **Positive:** a person can make a new case without handing it to everyone who once had all-cases access, and the choice binds every enforcement path through one tested rule. The tenant integrity of every exception is enforced by the database itself.
- **Negative / trade-offs:** every non-owner access check and every affected list query makes one extra presence query (a catalogue lookup). Revoked grants keep their exception rows (they reach nothing). An organization's evidence request list keeps its existing behaviour after a pause or revoke and hides only requests on cases excluded from all of its grants.
- **Follow-ups:**
  - Prepare Again itself (a later PR) must call `listCaseSharingQuestions` before creating the case and `applyCaseSharingAnswers` in the same transaction, throwing on any error so the case rolls back.
  - The four gaps found while building this were closed on the same branch (owner approval "close all four", 26 Oct 2026); see the amendment below.

## Alternatives considered

- **A per-case allow list on every grant (opt in instead of opt out).** Would change every existing all-cases grant's meaning; rejected.
- **Silently making Prepare Again cases private.** The owner chose to ask each time.
- **A savepoint read with a missing-table catch.** Rejected for the reason in decision 4.
- **Copying the exception check into each query.** Rejected: one rule in two proven-equal forms is the requirement.

## Amendment, 2026-10-26: the four gaps closed

1. **Restore.** Backup reconciliation (`packages/services/src/backup-reconciliation.ts`) replays `GRANT_CASE_EXCLUDED` and `GRANT_CASE_EXCLUSION_REMOVED` from the old branch's audit chain, in order (occurred time, then chain sequence). Only the last event for each grant or invitation and case is applied, so a second run is a clean no-op. A removal is replayed like a legal hold release: an explicit owner decision, applied in order. Nothing happens when the grant, invitation or case was made after the restore point (nobody can reach the case through it there). If an exception cannot be written, for example on a restored branch from before migration 0090, the grant is paused (revoked if still awaiting acceptance) or the pending invitation revoked, audited as `RECONCILIATION_CASE_EXCEPTION_FAIL_CLOSED`, and the error reported: the case is never left open. Invitation carry-over writes no event of its own; its grant postdates the restore point and the invitation-bound exception is replayed from its own event. `docs/operations/backup-resurrection-reconciliation.md` still needs the two new rows in its scope table (outside this change's file list).
2. **Account export.** Each grant in `grantsGranted` carries `caseExceptions` (case id, case title, when, and the account id that said no), so the JSON export and `grants_granted.csv` include them, and the manifest counts them. The recipient is named only as the grant already names it. A recipient's own export never shows an exception or the excluded case. Invitation-bound exceptions stay out with the invitations, which the export does not include.
3. **Case page.** The Self-reviewed note counts an organization only when one of its active grants reaches this case, through `grantReachesCase` (the policy predicate on the same `toPolicyGrant` mapping). This also stops a grant for another case from hiding the note.
4. **Policy export.** `packages/policy` exports `grantCoversMission`; the equivalence test checks it directly and through `authorize()` against the SQL rule.

## Amendment, 2026-10-26 (second): review fixes

A code review and a security review of the first version confirmed these changes; all follow the owner's standing rules and need no new decision.

1. **Answers are one-shot per case.** `applyCaseSharingAnswers` refuses a second call for a case once any `GRANT_CASE_EXCLUDED` or `GRANT_CASE_ALLOWED` event exists for it; later changes go only through "Allow This Case". Exactly the rows inserted are audited (`returning`), so the table and the audit trail always agree and a restore, which replays the trail, ends where the owner left it.
2. **One sharing lock per person.** A transaction-scoped advisory lock (`lockCaseSharing`, key `visastack:case-sharing:<applicant id>`) is taken before any grant or invitation is read by: recording answers, accepting a sharing invitation, creating an all-cases grant and creating an all-cases invitation. Without it, a "no" recorded while an invitation is being accepted could be lost.
3. **Exceptions follow the recipient.** A new all-cases grant or invitation for the same recipient (same organization; or the same person, matched by account and by invited email) inherits every exception that recipient has on this person's cases under earlier grants or invitations, live or ended, audited `GRANT_CASE_EXCLUDED` with reason `carried_forward`. A grant for one named case is an explicit share and reaches that case. "Allow This Case" removes the same case's exceptions on that recipient's ended grants and closed invitations too, so the old "no" is not carried forward again. The owner is told a case is "Not Shared" with someone only when none of that recipient's live grants reaches it (Sharing page, Application Memory); otherwise the Sharing page says "Shared Separately".
4. **Ended grants no longer keep hidden records visible.** An organization's own evidence requests and in-app notices about a case are listed only when one of its live grants (active, paused or awaiting acceptance, not expired) reaches the case; only when it holds no live grant on the person at all do they stay as history (`orgCaseRecordVisibleSql`).
5. **The case's own organization.** An organization that runs a case (`missions.owner_organization_id`) cannot be excluded from it (a plain refusal) and is never carried an exception for it.
6. **Restore fails closed by revoking.** When an exception cannot be written during reconciliation, the grant or pending invitation is revoked, never paused. The runbook lists all four events.
7. **Hardening.** A grantee none of whose grants reaches a case gets exactly the not-found an unknown id gets; a case id is trusted only for the person it belongs to (`orgGrantPermits` and the agency note, task and appointment lists); the presence check resolves the table through the search path and remembers only "present" per database handle; while the table is missing, answers where everyone was ticked go ahead (nothing to write).
8. **Pending invitations.** The Sharing page lists a pending all-cases invitation's exceptions read-only ("Not Shared: <case>"), and the account export lists invitation-bound exceptions apart (`invitationCaseExceptions`), with the invitation id, email and status.
