# Commercial V1 Threat Model

Part 2, Section 1 of `docs/roadmap/commercial-v1-implementation-directive.md`. Grounded in
actual code and, where noted, a live read-only query against VisaStack's real WorkOS
workspace (via the connected WorkOS MCP connector) rather than assumption. Does not claim
certification; see `docs/commercial-v1/asvs-l2-map.md` for the companion control mapping.

## System and trust boundaries

- **Browser (untrusted).** Any client-supplied value (IDs, form fields, files) is a lookup
  input only, never an authorization assertion (`packages/policy/src/authorize.ts` design
  law: "UUID possession is never authorization").
- **Next.js app (`apps/web`), server actions and API routes.** Trusted to enforce
  authorization, but only as strong as the checks each entry point actually calls;
  `packages/services` is supposed to be the single place those checks live
  (`docs/governance/integration-and-cleanup-directive.md`: "All UI must call the canonical
  service layer").
- **`packages/services` (the write side).** The actual trust boundary for domain
  authorization: every service function read this session (`profile.ts`, `missions.ts`,
  `agency.ts`) routes mutations through `authorize()` or an explicit ownership/grant check,
  and audits denials. This is real, not aspirational, for the functions read so far.
- **`packages/policy`.** The authoritative allow/deny decision point (`authorize.ts`,
  `types.ts`). Default-deny; membership alone is never access; step-up is a separate gate on
  top of an allowed decision.
- **Postgres (Neon).** The only canonical writable store. `audit_events` has a real,
  DB-enforced append-only property (`CREATE RULE "audit_events_no_update" ... DO INSTEAD
  NOTHING`, `CREATE RULE "audit_events_no_delete" ...`, confirmed in
  `packages/db/migrations/0000_superb_blazing_skull.sql`), which stops an application-level
  bug or compromised app credential from editing history — but does **not** stop a
  DB-superuser-level operator, a migration credential, or a direct backup edit; see SEC-04
  below.
- **WorkOS (external IdP).** Owns authentication; the app must not re-implement it, but must
  not blindly trust "signed in" as "sufficiently assured" either — see the MFA section below,
  which is the most important finding in this document.
- **Vercel Private Blob (or Neon-bytea fallback) / object storage.** Holds document bytes.
  `VercelPrivateBlobStorage` is the active production backend; `NeonBlobStorage` is a
  reduced-control local/test/PR-preview-only fallback that "production now fails closed
  rather than silently degrading to it" (README).
- **AI provider (OpenAI today; Gemini/Anthropic planned, Part 8).** Receives only
  deterministically pre-extracted text plus the field-key allowlist, never raw file bytes or
  the whole profile (confirmed in `packages/adapters/src/openai-extraction.ts`).

## Privileged components

- `packages/policy` (the only place an allow/deny decision may be made).
- The DB migration/admin credential (must stay separate from the app runtime credential —
  not yet independently verified this session; flagged as a check for the schema work below).
- `platformRoles` (PLATFORM_OWNER, SECURITY_ADMIN, COMPLIANCE_ADMIN, SUPPORT_ADMIN) — exists
  in `packages/db/src/schema.ts` with proper grant/revoke history and a DB-level
  at-most-one-active-grant-per-role uniqueness constraint. No support-grant table (scoped,
  time-limited, reasoned, max 60 minutes, per SEC-06) exists yet — genuinely new, see below.
- The AI gateway's provider API key (Part 8 scope; not yet KMS-backed, per the ledger).
- Whoever holds `mcp__WorkOS__mutate` access to VisaStack's live WorkOS workspace (this
  session has it, per the connected connector) — capable of, among other things, flipping
  environment-wide authentication policy in production. Treated in this threat model as an
  operational privilege on par with a production database credential, not as routine tooling.

## Threats and current disposition

### Account takeover / weak or recovered authentication

WorkOS AuthKit owns the credential; `apps/web/src/lib/session.ts`'s `withSession` binds the
signed-in WorkOS user to a local account by immutable `workosUserId`, never a client-supplied
id. No local password exists to be weak. Recovery flows are WorkOS's own; this app does not
implement a parallel one (directive Part 1 §8 forbids a parallel auth stack, and none exists).
**Residual risk:** account recovery ultimately relies on WorkOS's own recovery flow, which
this session cannot independently audit without live WorkOS documentation access (partially
blocked this session, see below); if recovery can bypass whatever MFA policy is eventually
set, that would defeat it. Track as a live-verification item once MFA enforcement is decided.

### Staff MFA bypass — the most significant finding in this document

**Confirmed, not assumed:** as of this session, staff/reviewer/support/platform-admin MFA is
enforced **nowhere** — neither in application code nor at the WorkOS identity-provider level.

- Application code: `withSession` (the single entry point nearly every server action and page
  uses) calls `withAuth()` to get the signed-in WorkOS user and does nothing else
  authentication-strength-related. It does not distinguish a traveller from a platform admin
  for authentication purposes at all. `apps/web/src/lib/step-up.ts`'s `checkRecentAuth`
  proves recency of the most recent authentication event (`auth_time`), not that a second
  factor was ever used — the PRD's own caution ("Recent login also does not, by itself, prove
  a second factor was used") is accurate and currently unaddressed.
- The installed WorkOS Node SDK's own type definitions (`@workos-inc/node@10.8.0`,
  `AuthenticationMethod` union in `lib/factory-B8vTFojy.d.mts`) list `'SSO' | 'Password' |
  'Passkey' | ...OAuth variants... | 'MagicAuth' | 'CrossAppAuth' | 'ExternalAuth' |
  'MigratedSession' | 'Impersonation'` — **no MFA-related value exists in this enum.** The
  session-level `authenticationMethod` field this app could read cannot, even in principle,
  answer "did this session use a second factor," because WorkOS does not expose that as a
  session claim in this SDK version. A separate, lower-level WorkOS MFA product surface
  exists in the same SDK (`enrollFactor`, `Factor`, `FactorType`, etc.) but is for a
  self-managed enrollment/challenge flow this app does not currently use anywhere (confirmed
  by a repository-wide search for `factor`/`mfa`/`totp`, which found nothing outside
  `node_modules`).
- The real, WorkOS-native mechanism is an **environment-level AuthKit setting**
  (`mfaEnabled: 'Off' | 'Optional' | 'Required'`, settable via the `updateAuthkitSettings`
  operation). Queried live against VisaStack's actual production WorkOS environment this
  session (`authkitSettings`, read-only): **`mfaEnabled` is currently `"Off"`.** If AuthKit's
  own sign-in flow required MFA at the environment level, a session could not exist without
  it having been satisfied, making a per-request application check largely redundant for that
  guarantee. But this setting is environment-wide, not organization- or role-scoped in the
  operations this session found — turning it on would require MFA for travellers too, which
  PRD IAM-01 explicitly says not to do for V1 ("Traveller MFA: supported and encouraged; not
  required by V1"). No organization-scoped override was found in the WorkOS operations
  surfaced to this session; this needs either further live investigation with WorkOS support/
  docs (currently unreachable — `workos.com` is blocked by this session's network egress
  proxy) or a product decision to accept universal MFA for V1.

**This session did not flip the live `mfaEnabled` setting.** Changing a production identity
provider's authentication policy is a real, production-facing, potentially user-locking-out
action with a blast radius well beyond this git repository; it needs the product owner's
explicit authorization, not an autonomous tool call. Recorded as a DECISION REQUIRED item in
`assumptions-and-blockers.md`.

**Planned mitigation for this Part 2 (code-level, safe to build without touching live WorkOS
config):** a role-aware session gate that checks organization membership/platform-role before
granting access to staff/reviewer/support/admin surfaces (which this codebase substantially
already has via `isOrgAdmin`/`isActiveMember`/`platformRoles`), combined with clear
documentation that this is authorization, not authentication-strength enforcement, until the
environment-level or org-scoped MFA question above is resolved. A03/A27 test coverage will
make this gap's current state explicit rather than silently assumed fixed.

### Agency overreach / IDOR / BOLA / cross-tenant leakage

Strong existing foundation, independently confirmed by reading `agency.ts`: `orgGrantPermits`
re-derives standing from the real grant on every call (not cached role bookkeeping),
`listAssignedMissionIds`/`listAssignmentsDetailed`/`listApplicantsForOrganization` are all
scoped to the querying organization and to currently-active, accepted, unexpired grants (the
post-programme defect register's findings #3-#7, #31, #32 — all cross-tenant leakage classes
— are cited in the code as already fixed, with regression tests named in `agency.test.ts`
run output this session: "excludes revoked, paused, and unaccepted grants," "never lets a
mission-scoped bulk export reach beyond its scope," etc., all passing). Residual risk is
concentrated in code this session has not yet read (evidence-vault binary delivery in Part 3,
export/search surfaces not yet audited) rather than in what's been read.

### Stale grants / removed memberships

`evaluateGrant` (`authorize.ts`) checks status/acceptance/time-window on every call, not once
at grant creation; `evaluateBase`'s `organization_member` branch denies immediately if
`!actor.membership.active`. This is evaluated fresh per request in every service function
read this session, not cached — the structural property SHR-02/A02 need. Not yet verified:
whether every actual HTTP entry point re-derives `membership.active` from the database on
each request rather than trusting a stale session claim; that check belongs to the
authorization audit this Part 2 still owes (see `known-issues.md`).

### Malicious support operator / platform-admin overreach

`platformRoles` gives auditable, revocable platform-level role grants, but **no scoped,
time-limited support-access-grant mechanism exists yet** (SEC-06 requires actor, subject/
resource scope, reason, approver, start, expiry, max 60 minutes, revocation, audit trail —
none of that is in the schema). Today, a `platform_role` holder's actual data-access
boundary is whatever the rest of the authorization code allows a `support_admin` actor kind
to do (`authorize.ts` has a real `support_admin` actor case, gated the same way as any other
grant recipient — "Support access is never an ordinary role permission... it requires an
explicit just-in-time support grant" per the code's own law 8 comment) — but nothing today
actually issues, time-bounds, or audits such a grant as its own first-class object. This is
the clearest genuinely-NEW piece of Part 2's SEC-06 scope; addressed in this part's schema
work below.

### Secret theft / plaintext database or backups

`factVersions.value` (`packages/db/src/schema.ts`) is a plain `text` column; `profile.ts`'s
`editFact` writes it directly with no encryption branch based on `fieldDefinitions.sensitivity`
(confirmed by reading the actual write path, not just the PRD's claim). A full database dump
or backup today contains passport numbers, financial declarations, and any other sensitive
fact value in cleartext. This is SEC-03's core gap; addressed in this part's schema work below,
though a full backfill of already-written plaintext rows and live KMS integration verification
is realistically multi-part work (this part lays the encryption architecture and the
additive schema; migrating existing rows and proving key rotation/recovery is explicitly
allowed to extend into later verification per the directive's own Part 2 §8 rules on
resumable, dry-run-capable backfills).

### AI exfiltration / prompt injection

`openai-extraction.ts` sends only pre-extracted, size-capped document text plus the
canonical field-key allowlist — never raw bytes, never the whole wallet, never other
applicants' data (confirmed by reading the actual request-construction code). The system
prompt instructs the model not to invent values and to mark anything outside the allowlist
`UNMAPPED`/`UNCERTAIN`. This is a real, structural minimization, not a policy statement alone.
Not yet verified: whether document text is treated as adversarial input capable of trying to
manipulate the *service layer's* handling of the model's response (as opposed to the prompt
itself) — deferred to Part 8's full AI-gateway work, where multi-provider support also
reopens this surface.

### Malicious documents

Deferred to Part 3 in full (the real malware-scanner gap, `EVI-02`/`SEC-05`, is already
recorded in `known-issues.md` item 1). Existing structural validation
(`BasicSafetyScanner`) is explicitly documented in this repo's own ADR-0011 as not antivirus.

### Unsafe export

`bulkExport` (`agency.ts`) re-authorizes per applicant at export time and respects category
scope from the *actual* granting grant, not a stripped/looser version — a real, structural
defense against the classic "export bypasses the same-time checks a read endpoint would
apply" bug class. Full export-surface audit (large ZIP construction, path safety, size limits)
is Part 7 scope per the directive; not re-verified this session.

### Audit tampering

DB-level append-only `RULE`s on `audit_events` (confirmed, see trust boundaries above) stop
an application-level actor from editing or deleting history through the ORM/app credential.
They do **not** stop a party with direct Postgres superuser/migration-credential access,
and no periodic signed checkpoint/anchor outside the mutable primary table exists yet
(SEC-04's explicit requirement). This session does not claim the audit chain is tamper-proof
against a fully privileged DB operator — only against the application's own normal write path,
which is the honest, narrower claim the evidence supports.

### Destructive restore / replay / race / idempotency defects

The existing job/erasure infrastructure (`processingJobs`, `erasureJobs`) shows real
discipline here: fencing tokens on leases, `deletionAttemptedAt` written *before* the delete
call (not after) specifically to avoid a window where a retry can't tell "never attempted"
from "attempted but the confirmation write failed," idempotency keys on job enqueue. This
pattern is a strong template to reuse for the support-grant and protected-field work in this
part, rather than re-inventing weaker concurrency handling. Recovery-specific replay of
deletion tombstones and revocations after a restore (per `docs/operations/recovery.md`
reconciliation with the PRD's stricter RPO/RTO target) is OPS-02/A30 scope, Part 9/10.

## What this session could not verify live

- `workos.com` documentation is blocked by this environment's network egress proxy; anything
  needing current WorkOS docs (beyond what the live MCP connector and the installed SDK's own
  type definitions could confirm) is marked BLOCKED rather than guessed.
- Whether an organization- or role-scoped MFA requirement exists in WorkOS beyond the
  environment-wide `mfaEnabled` setting found this session — needs either further live API
  exploration or WorkOS support confirmation.
- Whether the database runtime credential is actually separate from the migration/admin
  credential (SEC-01's explicit requirement) — not yet checked against actual deployment
  configuration this session.


## Current operating correction (2026-10-11)

Neon Auth is configured for production; legacy WorkOS references do not authorize email-only record linking or claim current staff MFA acceptance. Production uses private R2 storage; database-only encrypted archive recovery is verified, while complete document/key/lifecycle recovery remains open.

Earlier implementation snapshots and provider-specific instructions above are retained as history. For current setup, incident response and availability, use [current operating guidance](../operations/current-platform.md). Original acceptance and security targets remain in force; this correction does not mark them complete or authorize migration, production restore, paid activation or sensitive-data intake.
