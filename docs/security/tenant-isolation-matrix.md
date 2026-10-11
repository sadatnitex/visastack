# Tenant Isolation Matrix

Authority: master recovery directive §7 "PR 2"; Build Spec law 2
("organization membership alone never implies access") and law 5 ("mission
access never implies the whole Vault/Profile"). Companion to
[threat-model.md](./threat-model.md)'s "cross-tenant access/discovery" row —
this document is the concrete control-to-test map for that row, maintained
as tenant-isolation-relevant code changes.

An **organization** here is any agency/company tenant (`schema.organizations`).
Two organizations are isolated from each other, and from any applicant who
has not explicitly granted them access, by construction: nothing in this
system trusts organization membership as a proxy for data access (law 2).
The only thing that ever crosses the applicant/organization boundary is an
applicant-created, purpose-bound, accepted `Grant` — re-evaluated by
`authorize()` (`packages/policy/src/authorize.ts`) on every request, never
cached or assumed.

## Isolation boundaries

| Boundary | Enforcement | Verified by |
|---|---|---|
| Org A cannot read/act on an applicant who never granted Org A anything | Every collaboration entry point (`assignMember`, `addNote`, `requestEvidence`, `bulkExport`) calls `orgGrantPermits()` (`packages/services/src/agency.ts:51`), which re-derives standing from real, current grant rows — never from membership or from another org's grant | `tenant-isolation.test.ts` → "org B has zero standing on an applicant who only ever granted org A" |
| Org A admin cannot deactivate/reactivate a membership in Org B | `setMembershipActive()` (`packages/services/src/organizations.ts:326`) scopes the target lookup by `id AND organizationId` together, and separately verifies the actor holds an active OWNER/ADMIN membership in that same `organizationId` — a membership id alone is never sufficient | `tenant-isolation.test.ts` → "an org admin cannot deactivate or reactivate a membership belonging to a different organization (cross-tenant IDOR regression)" |
| An org member cannot act on a mission/applicant without a covering grant | `assignMember`/`addNote`/`requestEvidence` all require `orgGrantPermits()` to return true before touching any row; membership admin status alone (`isOrgAdmin`) is necessary but never sufficient | `agency.test.ts` (assign/note/evidence tests, each set up with an explicit grant) |
| Assignment (bookkeeping) never itself grants data access | `assignments` rows are never read by `authorize()` or by any grant-scope check — `packages/policy` has no knowledge of the `assignments` table at all; an assignment is a UI convenience, not a security boundary | `agency.test.ts` → "assigns a member (admin only) and records notes" (assignment requires a grant to exist first; the grant, not the assignment, is what `orgGrantPermits` checks) |
| A mission-scoped grant cannot reach a different mission of the same applicant | `evaluateGrant()` (`packages/policy/src/authorize.ts`) denies with `scope_mismatch` when `grant.missionId` is set and does not equal the resource's `missionId` | `tenant-isolation.test.ts` → "a mission-scoped grant does not authorize collaboration on a different mission of the same applicant"; `sharing.test.ts` → "a mission-scoped grant surfaces nothing and flags missionScopeUnavailable" |
| A category-scoped grant cannot reach a different pack's facts | `evaluateGrant()` denies `scope_mismatch` per-resource; `bulkExport()`'s category allow-list (`packages/services/src/agency.ts:637`) filters facts to the union of each allowing grant's own `categories` | `sharing.test.ts` → "categories scope which fields are visible"; `tenant-isolation.test.ts` → "bulk export excludes an applicant once the grant it depended on is revoked, and respects category scope" |
| A document-scoped grant cannot reach a different document | `evaluateGrant()` denies `scope_mismatch` when `grant.documentIds` is set and excludes the resource's `documentId` | `sharing.test.ts` → "documentIds scope which documents are visible" |
| A revoked, paused, or expired grant is denied on the very next request | `evaluateGrant()` checks `status`/`expiryAt` fresh on every call — no cached "is this grant good" flag exists anywhere | `sharing.test.ts` → "revoking the grant immediately blocks the workspace on the next call"; `tenant-isolation.test.ts` → "a paused grant blocks org-mediated access", "an expired grant blocks org-mediated access even while its status still reads ACTIVE" |
| A revoked grant can never resume (revocation is genuinely terminal) | `ownerTransition()` (`packages/services/src/sharing.ts`) is a compare-and-set `UPDATE ... WHERE status IN (allowedFrom)`; `resumeGrant`'s `allowedFrom` is `['PAUSED']` only, `pauseGrant`'s is `['ACTIVE']` only — `REVOKED` is not in either | `tenant-isolation.test.ts` → "a revoked grant is permanently terminal: cannot resume, cannot pause, cannot re-accept" |
| Two concurrent transitions on the same grant never both land | Every lifecycle write (`acceptGrant`, `ownerTransition`) is a single `UPDATE` whose `WHERE` clause re-checks the required starting status at write time (CAS), not merely at an earlier read | `tenant-isolation.test.ts` → "double-accepting the same grant: exactly one attempt succeeds", "two concurrent revoke attempts on the same grant: exactly one succeeds" |
| An individual (direct, non-organization) grant recipient cannot use it to act as if they were an organization member | `assignMember`/`requestEvidence` gate on `isOrgAdmin()`, which checks a real `schema.memberships` row — a personal grant creates no membership row anywhere, in any organization | `tenant-isolation.test.ts` → "a personal (individual) grant never substitutes for organizational membership" |
| A grant can only ever target an independently-verified organization | `createGrant()` (`packages/services/src/sharing.ts:99`) requires the recipient organization's `status === 'ACTIVE'` — an org can never verify itself (`reviewOrganization`, `packages/services/src/organizations.ts:181`, rejects a reviewer who is a member) | `sharing.test.ts` → "creates PENDING and cannot self-verify; an independent reviewer activates it"; every grant-creation test's fixture activates its org first |
| The last active OWNER of an organization can never be deactivated (an org can never lock itself out) | `setMembershipActive()` locks every `OWNER` row of the organization `FOR UPDATE` before evaluating whether any *other* active owner remains, so two concurrent deactivation attempts serialize instead of both independently observing "another owner exists" | `tenant-isolation.test.ts` → "cannot deactivate the sole remaining active owner", "deactivating one of two owners succeeds and the org retains exactly one active owner" |
| Raw UUID guessing never succeeds | Every lookup is either scoped to the caller's own membership/organization or returns `not_found`/`forbidden` for an unrecognized id — no code path treats "row not found" as "allowed" | `tenant-isolation.test.ts` → "raw UUID guessing never succeeds — random ids are not_found or forbidden, never allowed" |
| Sharing a record requires the owner's current, affirmative SHARING consent | `createGrant()` calls `hasConsent(db, actorAccountId, 'SHARING')` before any other validation; consent is per-purpose and independently revocable (Build Spec §13) | `packages/services/src/consent.ts` tests (`services.test.ts`); every grant-creation fixture across the suite now grants `SHARING` consent explicitly |

## Grant lifecycle (state machine)

```
PENDING_ACCEPTANCE -> ACTIVE     (acceptGrant — recipient/org OWNER-ADMIN only)
PENDING_ACCEPTANCE -> REVOKED    (revokeGrant — applicant owner only)
ACTIVE             -> PAUSED     (pauseGrant  — applicant owner only)
ACTIVE             -> REVOKED    (revokeGrant — applicant owner only)
PAUSED             -> ACTIVE     (resumeGrant — applicant owner only)
PAUSED             -> REVOKED    (revokeGrant — applicant owner only)
REVOKED            -> terminal (no transition reachable from here)
EXPIRED            -> terminal (no transition reachable from here; status is
                                 read dynamically from expiryAt, not written)
```

Every arrow above is a single, transactionally-conditional `UPDATE` — the
`WHERE` clause embeds the required starting status, so an illegal or
double-fired transition fails atomically rather than via a read-then-write
race. See `packages/services/src/sharing.ts`'s `ownerTransition()` doc
comment for the full rationale.

## What this does NOT yet cover (tracked, not silently dropped)

- **Step-up-gated actions** (`SHARE`, `EXPORT_PROFILE`, `DOWNLOAD_ORIGINAL`):
  the policy engine correctly denies these without `stepUpSatisfied`. PR 5
  built a real WorkOS step-up flow and wired it into `EXPORT_PROFILE`
  (`bulkExport`'s platform capability now reports `available`); `SHARE` and
  `DOWNLOAD_ORIGINAL` remain ungated (no live UI trigger to wire yet) — see
  `docs/security/identity-and-step-up-boundary.md` for the full map.
- **Document trust boundary** (malware scanning, redacted renditions,
  third-party preview): PR 3 scope.
- **Platform-admin/support access isolation**: PR 5 replaced the
  `ADMIN_EMAILS` allowlist with a real, auditable, revocable platform-role
  model; see `docs/security/identity-and-step-up-boundary.md`. The
  `support_admin` policy-engine actor kind is not yet wired to it.

## Verification

`packages/services/src/tenant-isolation.test.ts` is the dedicated hostile-
authorization suite for the boundaries above. `packages/services/src/agency.test.ts`
and `packages/services/src/sharing.test.ts` cover the same boundaries in the
context of each feature's normal-path tests. Re-run on every change to
`packages/policy`, `packages/services/src/{agency,organizations,sharing}.ts`,
or the `grants`/`memberships`/`assignments` schema.


## Current operating correction (2026-10-11)

Neon Auth is configured for production; legacy WorkOS references do not authorize email-only record linking or claim current staff MFA acceptance.

Earlier implementation snapshots and provider-specific instructions above are retained as history. For current setup, incident response and availability, use [current operating guidance](../operations/current-platform.md). Original acceptance and security targets remain in force; this correction does not mark them complete or authorize migration, production restore, paid activation or sensitive-data intake.
