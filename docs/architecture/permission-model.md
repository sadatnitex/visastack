# Permission Model

Authority: Build Spec §11–12, PRD §12–13. The VisaStack **policy engine is
server-authoritative** for applicant resources — WorkOS provides identity,
not authorization (Build Spec §15).

## Evaluation inputs

Actor · account status · organization membership · applicant relationship ·
mission assignment · document/category · requested action · purpose ·
grant start/expiry · risk context · step-up status.

## Actions

`VIEW_METADATA` · `PREVIEW` · `COMMENT` · `PROPOSE_EDIT` · `APPROVE_EDIT` ·
`DOWNLOAD_ORIGINAL` · `DOWNLOAD_REDACTED` · `DOWNLOAD_PACK` ·
`EXPORT_PROFILE` · `SHARE` · `MANAGE`

## Laws (each is a test)

1. **Default deny.**
2. Organization membership alone never implies metadata access.
3. `PREVIEW` never implies `DOWNLOAD_*`.
4. `DOWNLOAD_REDACTED` never implies `DOWNLOAD_ORIGINAL`.
5. Mission access never implies the whole Vault/Profile.
6. Expired/revoked access (grant, membership, or the organization's own
   status) fails the **next** server request - no cached allow.
7. Recipient acceptance is required for a grant to take effect.
8. Support/admin access is **not** an ordinary role permission — it is
   just-in-time, reasoned, approved, time-limited, and visible to the
   applicant.
9. A per-case sharing exception removes exactly one case from an all-cases
   grant (ADR 0017). The grant keeps covering every other case. Documents and
   profile details keep their own grant scope: an exception hides only what
   belongs to the case (the case, its evidence links, requirements, requests,
   notes, tasks, appointments, decisions and outputs). One rule decides it,
   `grantCoversMission` in packages/policy, with its SQL form
   `grantCoversCaseSql` proven equal by a test. Exceptions follow the
   recipient: a later all-cases grant or invitation to the same recipient
   inherits them, while a grant for that one case is an explicit share and
   reaches it. A grantee that no grant reaches a case through gets the same
   not-found as an unknown id.

## Step-up authentication

Required for: sharing, profile export, original/bulk download, and
restricted categories (Build Spec §14). MFA is required for agency,
reviewer, and support roles.

## Download/preview enforcement sequence (Build Spec §12)

1. User invokes an action.
2. Server re-authenticates session + step-up state.
3. Policy engine **re-evaluates** effective permission at request time.
4. Required audit event is committed — **if it cannot commit, deny.**
5. Server streams the file, or issues a very short-lived, operation-specific
   signed URL (no permanent public URL).
6. `Content-Disposition` uses the approved display filename.
7. Result is logged (actor, org, applicant, document/version, mission,
   grant, action, time, IP/device, result).

## Absolute acceptance gates tied here

- 100% of preview/download/export actions require effective action
  permission at request time.
- 100% of cross-tenant attempts denied and logged with no data leakage.
- 0 permanent public document URLs.


## Current operating correction (2026-10-11)

Neon Auth is configured for production; legacy WorkOS references do not authorize email-only record linking or claim current staff MFA acceptance.

Earlier implementation snapshots and provider-specific instructions above are retained as history. For current setup, incident response and availability, use [current operating guidance](../operations/current-platform.md). Original acceptance and security targets remain in force; this correction does not mark them complete or authorize migration, production restore, paid activation or sensitive-data intake.
