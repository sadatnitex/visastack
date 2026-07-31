# Identity, Platform Administration and Step-Up Boundary

Authority: master recovery directive §7 "PR 5"; Build Spec §14.
Companion to [tenant-isolation-matrix.md](./tenant-isolation-matrix.md),
[document-trust-boundary.md](./document-trust-boundary.md), and
[erasure-and-retention-boundary.md](./erasure-and-retention-boundary.md)'s
same pattern — this is the concrete control-to-test map for identity
binding, platform administration, and step-up/reauthentication, maintained
as identity/admin/step-up-relevant code changes.

## WorkOS identity race

| Control | Enforcement | Verified by |
|---|---|---|
| A unique-constraint collision on concurrent account creation never hands one identity another identity's account | `createAccount` (`packages/services/src/accounts.ts`) looks up by the immutable `workosUserId` first; returns the existing row only when its stored `workosUserId` matches; an email match belonging to a *different* `workosUserId` is never trusted as a fallback | `accounts.test.ts` → "two concurrent sign-ins racing on the same email but DIFFERENT identities: exactly one succeeds, never a cross-identity account" (genuine `Promise.all` race against a shared PGlite connection) |
| A genuine conflict fails closed, not silently | Returns `forbidden` and records `ACCOUNT_IDENTITY_CONFLICT` (audited, no PII beyond the existing account reference) rather than guessing which identity should win | Same test; also `accounts.test.ts` → "refuses a different identity signing in with an email already bound" |
| An email match may still be *claimed* — but only through the pre-existing, verified legacy-binding flow (unchanged by this PR) | `provisionAccount`'s legacy-claim path already required a verified email before binding; `createAccount`'s race-recovery path never independently grants that same trust on a bare email match | `accounts.test.ts` → "claims a legacy (unbound) account by verified email, once, and audits it" / "refuses to claim... when the email is NOT verified" |
| `isUniqueViolation` actually recognizes a real Postgres unique-violation, including through Drizzle's error wrapping | Drizzle's `queryWithCache` wraps every query error in `DrizzleQueryError`, with the real driver error (and its `.code`) as `.cause` — checking `error.code` directly never matches. `isUniqueViolation` (`packages/services/src/db.ts`) walks up to 3 `.cause` levels | `db.test.ts` — raw, singly-wrapped, and doubly-wrapped error shapes, plus negative cases (wrong code, no code, non-error values) |

## WorkOS ID migration

The directive calls for a report/dry run, then (after confirming all
legitimate accounts are bound) a migration making `workos_user_id`
non-null.

| Control | Status |
|---|---|
| Report/dry run: which accounts have no bound WorkOS identity, and how many applicants each owns | Built — `reportUnboundAccounts` (`packages/services/src/accounts.ts`), surfaced on `/app/admin` when the list is non-empty |
| `workos_user_id NOT NULL` migration | **Deliberately not written in this PR.** This sandbox cannot verify whether real production data currently has legitimate unbound accounts — running a `NOT NULL` migration blind, against data this environment cannot see, is a production-data-shape decision, not a code-correctness one. Run the report against production first; once it confirms zero (or explicitly resolved) unbound accounts, add the migration as its own follow-up. Migration `0010` is untouched, as required |

## Platform administration

| Control | Enforcement | Verified by |
|---|---|---|
| `ADMIN_EMAILS` is no longer an ongoing authority | `platform_roles` (migration `0019`) is the real, queried authority — `hasAnyPlatformRole`/`isPlatformOwner` (`packages/services/src/platform-roles.ts`) check active grants first | `platform-roles.test.ts` |
| Cold start is still possible without a permanent backdoor | `ADMIN_EMAILS`-listed emails get owner-equivalent access *only* while `platform_roles` has zero total rows (ever — including revoked). The instant one real grant exists, the bootstrap path never applies again, even if the env var stays configured | `platform-roles.test.ts` → "grants owner-equivalent access via the bootstrap email list while no grant exists" / "stops applying the moment a single real grant exists, even for the bootstrap email itself" |
| Roles are minimal and named, not a universal super-admin | `PLATFORM_OWNER`, `SECURITY_ADMIN`, `COMPLIANCE_ADMIN`, `SUPPORT_ADMIN` — exactly the directive's suggested set | `packages/db/src/schema.ts` — `platform_role` enum |
| Every grant/revoke is accountable and immutable | Each row records `accountId`, `workosUserId` (denormalized at grant time), `role`, `assignedByAccountId`, `assignedAt`, `reason`; revocation sets `revokedAt`/`revokedByAccountId`/`revokedReason` — a row is *never* deleted, only marked revoked | `platform-roles.test.ts` → "revocation preserves the row (never deletes) and removes access" |
| A non-owner cannot grant or extend roles, even to themselves | `grantPlatformRole`/`revokePlatformRole` are `PLATFORM_OWNER`-gated | `platform-roles.test.ts` → "a non-owner cannot grant roles, even to themselves" |
| The system can never end up with zero platform owners | `revokePlatformRole` refuses to revoke the sole remaining active `PLATFORM_OWNER` (mirrors the existing "sole remaining active org owner" safeguard from PR 2) | `platform-roles.test.ts` → "refuses to revoke the sole remaining platform owner" / "allows revoking one of two owners, leaving the system with exactly one" |
| Every grant/revoke is audited | `PLATFORM_ROLE_GRANTED`/`PLATFORM_ROLE_REVOKED` audit events, inside the same transaction as the row change | `platform-roles.test.ts` → "records both the grant and the revoke in the audit trail" |

## Step-up / reauthentication

The mechanism (`packages/services/src/step-up.ts` +
`apps/web/src/lib/step-up.ts`) is two layered checks, neither of which is a
browser-supplied boolean:

1. **Genuine session recency.** `checkRecentAuth({ maxAge })`
   (`@workos-inc/authkit-nextjs`) reads the real `auth_time` claim off the
   signed WorkOS access token, server-side. When stale, `getSignInUrl({
   maxAge, returnTo })` forwards OIDC `max_age` so WorkOS's own IdP forces a
   fresh credential challenge — not a local dialog standing in for one.
2. **Action-bound assurance.** A fresh WorkOS session establishes recency in
   general; it says nothing about *which* sensitive action it should cover.
   `issueStepUpAssurance`/`verifyStepUpAssurance` mint and check a signed
   (HMAC-SHA256, same primitives as `blob-token.ts`), short-lived (5 min),
   action- and resource-bound token — a token minted for one action or
   resource is never accepted for another.

`establishStepUp` (`apps/web/src/lib/step-up.ts`) does both in one call:
fresh session → mint-and-verify a real assurance record and report
`satisfied: true`; stale session → a genuine WorkOS reauthentication URL to
redirect to, with `returnTo` pointing back to the same request so completing
reauth lets the caller retry.

Every gated service function below takes a required `stepUpSatisfied:
boolean` — never optional, never defaulted to `true` — mirroring
`bulkExport`'s existing discipline (the directive's own named example of
what *not* to do: `bulkExport()` used to hardcode `stepUpSatisfied: true`).
Denial returns the shared `step_up_required` `ServiceErrorCode`
(`packages/services/src/errors.ts`), never deletes/mutates anything, and
takes effect *before* the action's own domain checks so a denied caller
learns nothing about whether the target resource even exists.

| Directive-listed action | Enforced at | Sensitivity gate | Verified by |
|---|---|---|---|
| Bulk export | `bulkExport()` (`agency.ts`), fed from `app/agency/[orgId]/export/route.ts` (GET, redirects to reauth) | Always (the whole endpoint) | `capabilities.test.ts`; `agency.test.ts` (`bulkExport` denies without `stepUpSatisfied`) |
| Profile export (self) | `app/privacy/export/route.ts` (GET, redirects to reauth) | Always (the whole endpoint) | `apps/web/src/lib/step-up.test.ts` (the shared `establishStepUp` gate); `exportAccount` has no policy-engine step-up hook of its own (self-access needs no grant) — the route is the only gate |
| Granting highly sensitive access | `createGrant()` (`sharing.ts`), fed from `applicant/[id]/sharing/actions.ts` `createGrantAction` | Conditional — only when the requested `actions` include a `STEP_UP_ACTIONS` member (`DOWNLOAD_ORIGINAL`/`EXPORT_PROFILE`/`SHARE`); an ordinary view/preview/comment grant is never gated | `sharing.test.ts` → "refuses to create a grant handing out DOWNLOAD_ORIGINAL without step-up" / "...once step-up is honestly satisfied" / "never requires step-up for an ordinary grant" |
| Platform-role changes (grant) | `grantPlatformRole()` (`platform-roles.ts`), fed from `admin/actions.ts` `grantPlatformRoleAction` | Always | `platform-roles.test.ts` → "refuses to grant a platform role without step-up, even for a genuine platform owner" |
| Platform-role changes (revoke) | `revokePlatformRole()` (`platform-roles.ts`), fed from `admin/actions.ts` `revokePlatformRoleAction` | Always | `platform-roles.test.ts` → "refuses to revoke a platform role without step-up..." |
| Legal-hold changes (place) | `placeLegalHold()` (`legal-hold.ts`), fed from `admin/actions.ts` `placeLegalHoldAction` | Always | `retention.test.ts` → "refuses to place or release a legal hold without step-up" |
| Legal-hold changes (release) | `releaseLegalHold()` (`legal-hold.ts`), fed from `admin/actions.ts` `releaseLegalHoldAction` | Always | Same test |
| Retention execution | `purgeExpiredDocuments()` (`retention.ts`), fed from `admin/actions.ts` `purgeExpiredDocumentsAction` | Always | `retention.test.ts` → "refuses to run retention purge without step-up, queuing nothing" |
| Organization verification | `reviewOrganization()` (`organizations.ts`), fed from `admin/actions.ts` `reviewOrganizationAction` | Always | `sharing.test.ts` → "refuses to review an organization without step-up..." |
| Account deletion confirmation | `privacy/actions.ts` `requestDeletionAction` (web-layer only — `requestAccountDeletion` itself is unconditionally self-only, so there is no separate service-layer sensitivity decision to gate) | Always (cancelling a pending request is not gated — undoing a dangerous action needs no extra proof) | `apps/web/src/lib/step-up.test.ts` (the shared gate) |
| Original download | **Not wired.** No live UI route calls `downloadDocument` anywhere in `apps/web` — only tests exercise it | `documents.ts`'s `stepUpSatisfied` already defaults to `false` (fail closed) independent of any caller, so there is no live gap to close; wire this when a download UI is actually built (PR 7/8 territory) |

`apps/web/src/lib/step-up.test.ts` covers `establishStepUp` itself (the one
function that ultimately backs every row's *web-layer* `stepUpSatisfied:
true`): a fresh WorkOS session mints and self-verifies a real assurance
record; a stale session returns the genuine WorkOS reauth URL
(`getSignInUrl`'s actual return value, never a locally-constructed
substitute) and never reports satisfied; `maxAge` and `returnTo` are
forwarded exactly; a missing `STEP_UP_SIGNING_SECRET` throws rather than
silently proceeding. It mocks only the two WorkOS SDK entry points
(`checkRecentAuth`/`getSignInUrl`) — the assurance mint/verify round trip
runs for real. What remains unverified by an automated test is each web
call site's own plumbing (right accountId/action/resourceId, redirect vs.
inline denial) — exercise that by hand against a real WorkOS session before
relying on a newly-added gated action in production. The *service-layer*
denial (what happens when `stepUpSatisfied` is honestly `false`) is fully
covered by PGlite tests for every row above except account deletion, which
has no service-layer gate to test — see that row's note.

Every server-action call site above shares one shape: authorize first
(`isPlatformAdmin`/`isPlatformOwnerAccount`/ownership), *then* check
step-up, *then* mutate — so an unauthorized caller never learns that
step-up is the only thing standing between them and the action. A stale
session sends the browser through `redirect()` (`next/navigation`) to the
real WorkOS reauth URL; a GET route returns an HTTP redirect to the same
place. Neither path is reachable by a client supplying a boolean.

## What this does NOT yet cover (tracked, not silently dropped)

- **Original download step-up** — see the table above. The service-layer
  gate already fails closed; only the UI wiring is missing, and there is no
  UI to wire yet.
- **`workos_user_id NOT NULL` migration** — deferred pending a real
  production run of `reportUnboundAccounts`; see "WorkOS ID migration"
  above.
- **`SUPPORT_ADMIN`'s relationship to the policy engine's
  `support_admin` actor kind.** The policy engine (`packages/policy`) has
  had a `support_admin` `Actor` kind since before this PR; this PR's
  `platform_roles` model is the accountable *grant* of platform-level
  roles, but no code path yet constructs a `support_admin` policy actor
  from a `SUPPORT_ADMIN` platform-role grant. Platform-admin surfaces today
  (`/app/admin`) check `isPlatformAdmin`/`isPlatformOwnerAccount` directly,
  not the policy engine. Unifying the two is a future PR's concern if a
  concrete need for policy-engine-mediated support access arises.
- **Step-up assurance tokens are single-request, mint-and-verify-together.**
  `establishStepUp` never returns a token to the caller for reuse across
  multiple later requests — every gated action re-checks WorkOS session
  recency on its own call. This is deliberately conservative (simpler to
  reason about, no token to leak or replay) at the cost of an extra
  `checkRecentAuth` read per action; revisit only if that read is ever
  measured to matter.

## Verification

`packages/services/src/{accounts,db,platform-roles,step-up}.test.ts` and
`apps/web/src/lib/step-up.test.ts` are the dedicated suites;
`packages/services/src/{sharing,retention}.test.ts` cover the
sensitive-grant, legal-hold, retention-purge, and organization-review
step-up gates in context (each has both a "denies without" and an
"allows with / existing behavior unchanged" test). Re-run on every change
to `packages/services/src/{accounts,db,platform-roles,step-up,sharing,
legal-hold,retention,organizations}.ts`,
`apps/web/src/lib/{admin,step-up,session}.ts`, or
`apps/web/src/app/app/{admin,privacy,applicant,agency}/**/actions.ts`.
