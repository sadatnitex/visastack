# Per-case sharing exceptions: approved plan (26 Oct 2026)

Copied from the session's working plan so later sessions have it. File and line references were taken on main 309625c and may have moved.


Owner decisions:
- When a new case is made with Prepare Again, the person is ASKED, for each grantee holding an all-cases grant (grants.missionId IS NULL), whether that grantee may see the new case. No answer means no.
- A "no" excludes that one case from that all-cases grant everywhere; the grant keeps covering every other case. The owner can later remove an exception ("Allow This Case"), which restores access to that case. Revoking the grant makes exceptions moot.
- The answer also binds PENDING all-cases sharing invitations: if such an invitation is accepted later, the new grant inherits the exclusions recorded against the invitation.
- Removing an exception asks for a fresh sign-in only when the original sharing needed one (mirror createGrant's STEP_UP_ACTIONS rule): lowest friction with the same protection.
- Migration 0090 is pre-approved to run right after the merge.

## 1. Schema (migration 0090, generated with drizzle-kit: `pnpm --filter @visastack/db db:generate --name grant_case_exclusions`, then biome format the snapshot and journal)
Table `grant_case_exclusions` in packages/db/src/schema.ts next to `grants` (~692-740):
- `id` uuid pk; `grant_id` uuid NULL FK grants ON DELETE CASCADE; `sharing_invitation_id` uuid NULL FK sharing_invitations ON DELETE CASCADE; `mission_id` FK missions ON DELETE CASCADE NOT NULL; `applicant_id` FK applicants ON DELETE CASCADE NOT NULL; `created_by_account_id` FK accounts ON DELETE SET NULL; `created_at`.
- CHECK exactly one of grant_id, sharing_invitation_id is set.
- Unique (grant_id, mission_id) and unique (sharing_invitation_id, mission_id) (partial unique indexes where the column is not null); indexes on applicant_id and mission_id.
- Tenant integrity: composite FKs (grant_id, applicant_id) -> grants(id, applicant_id) and (mission_id, applicant_id) -> missions(id, applicant_id), and (sharing_invitation_id, applicant_id) -> sharing_invitations(id, applicant_id) if that table has applicant_id (check; if not, enforce in the service and test it). These need additive unique(id, applicant_id) constraints on the parent tables (new pattern in this repo: comment it).
- Removing an exception is a hard delete; audit keeps the history.
- Missing table (42P01 naming grant_case_exclusions only): reads treat it as "no exclusions" (safe: no row can exist before the migration). The WRITE side refuses: while the table is missing, a Prepare Again with at least one all-cases grantee (or pending all-cases invitation) returns `unavailable` and its transaction rolls back the case it was creating, so a "no" is never lost. Every other error throws and fails closed. No caching. Never ship a down-migration dropping this table.

## 2. Enforcement: one rule, two forms
- Pure predicate `grantCoversMission(grant, missionId)` in packages/policy/src/authorize.ts. `Grant` (types.ts:23) gains `excludedMissionIds?`. `evaluateGrant` (authorize.ts:77) denies `scope_mismatch` when the resource's missionId is in that list.
- New packages/services/src/access/grant-scope.ts: `loadCaseExclusions(db, applicantId | grantIds)` (savepoint read, pattern from profile-photos.ts:330), `grantCoversCaseSql(missionIdExpr)` (own case, or all-cases AND NOT EXISTS an exclusion), `withCaseExclusions(db, run)` (re-run without the NOT EXISTS only on the missing-table error). A test proves SQL and JS forms agree on a fixture matrix. (access/ is exempt from the ratchet at enforcement.test.ts:553.)
- Inherit automatically: attach exclusions in `loadGrantsForPolicy` (sharing.ts:41-64) via a new exported pure `toPolicyGrant`; then requireAccess (require-access.ts:544; covers console-data.ts:138, mission/[id]/page.tsx:352, memory, insights, photo gates), orgGrantPermits (agency.ts:106) and through it assignMember 197, canReadMissionCollaboration 391 (assignments, tasks 447, appointments 982, notes 1323), loadMissionForOrgWrite 482, requestEvidence 1452, loadEvidenceRequestForOrg 2165, listEvidenceRequestDecisions 2584, recordMissionDecision 2859, listMissionDecisions 2992, listMissionRequirementsForOrg 3030, missions.ts listSelectedEvidenceForOrg 1875, assurance.ts 433; addNote's individual-recipient branch (agency.ts:1211).
- Explicit edits: agency.ts listMissionsForOrganization 1018-1042 (replace the JS filter at 1042 with the fragment; feeds listVisibleMissionsForMember 1089, listUnassignedActiveMissions 307, cases page, Do Next); workspace-search.ts:75; notifications.ts checkRecipient 376-382; agency.ts listEvidenceRequestsForOrg 1586 and listRespondingDocumentStatesForOrg 1986 (drop requests on cases the organisation no longer covers); agency.ts bulkExport 2683-2702 use toPolicyGrant; access transparency: application-memory.ts getApplicationMemory 272-301 and 395 gains per-case "Not shared with"; sharing.ts listAccessForApplicant(Detailed) 530/556 gains caseExceptions.
- NOTE: agency.ts, missions.ts and assurance.ts are on the WP-V4 allowlist only partly: agency.ts and missions.ts ARE listed; assurance.ts is NOT. If assurance.ts needs an edit (it should inherit through orgGrantPermits without one), stop and report.
- Checked, no change needed: owner-only paths (ai.ts, snapshots, appointment ICS via missions.ts ownedMission 75, account export); document-level paths (documents.ts 1021, blob route recheck, wallet.ts 118, getRecipientWorkspace 752, contributor-requests.ts 186). Invitation acceptance (sharing-invitations.ts:151) must now copy invitation-bound exclusions onto the new grant, in the same transaction, and delete the invitation-bound rows.
- Documents: an exception hides only what belongs to the case (the case, its selected_evidence links, requirements, evidence requests, notes, tasks, appointments, decisions, outputs). Documents keep their own grant scope (documents have no mission_id; law 5 in docs/architecture/permission-model.md:25). The question the person sees says so in plain words.

## 3. Write side (sharing.ts, owner only, all through requireAccess proofs; the baseline must not grow)
- `listCaseSharingQuestions(proof<VIEW_METADATA>)`: all-cases grants ACTIVE, PAUSED or PENDING_ACCEPTANCE and not expired, plus pending all-cases sharing invitations, with plain recipient labels.
- `applyCaseSharingAnswers(proof<MANAGE> on missionId, { allowedGrantIds, allowedInvitationIds })`: same transaction as case creation; excludes every all-cases grant and pending invitation not ticked (computed at apply time); checks same applicant and all-cases; on conflict do nothing; audits GRANT_CASE_EXCLUDED per "no" and GRANT_CASE_ALLOWED per "yes"; refuses `unavailable` if the table is missing; never notifies the grantee.
- `removeCaseException(proof<MANAGE> on missionId, { grantId })`: deletes the row; audits GRANT_CASE_EXCLUSION_REMOVED; refuses on a revoked or expired grant; step-up only if the grant carries STEP_UP_ACTIONS (mirror createGrant).
- Add the three audit event types where audit event types are declared (check whether that is inside the allowlist; if not, stop and report).
- Sharing page (apps/web/src/app/app/applicant/[id]/sharing/page.tsx and actions.ts): under each all-cases grant, "Not Shared: <case title>" with an "Allow This Case" button; server action through requireAccess.
- Prepare Again itself is a LATER PR; this PR only adds the services functions and the Sharing page view, fully tested.

## 4. Tests
- New packages/services/src/case-exclusion-enforcement.test.ts (createMigratedPglite): case C1 (old) and C2 (excluded for organisation A and person P); organisation B not excluded. Every path in section 2: A and P denied on C2 (list, page gate, evidence, notes, tasks, appointments, requirements, decisions, search, notifications, memory) and allowed on C1; B allowed on C2; A still reaches documents its grant covers. After removal A reaches C2 again. After revoke everything is denied. A pending invitation with a recorded "no", accepted later, gives a grant that cannot reach C2.
- Policy tests (authorize.test.ts): excluded case, other case, mission-less resource, mission-scoped grant, exclusion on another grant.
- Missing table: drop the table; reads fall back, the outer transaction stays usable, the write refuses and rolls back; other errors throw.
- Write side: owner only, forged proof refused, idempotent, audit rows.
- Tenant isolation: a cross-applicant row is rejected by the composite FK and by the service check.
- Ratchet: baseline unchanged.
- Web: sharing page and actions tests.
- Prove each new guard fails by breaking real code temporarily.

## 5. Commits (reads land before any write can create a row)
1. Policy predicate. 2. Schema, migration, grant-scope. 3. Read paths and the matrix. 4. Write side, invitations, audit and tenant tests. 5. Sharing page, ADR (new docs/adr/0017-per-case-sharing-exceptions.md from the template), permission-model law 9, known-issues, ledger, STATUS.
