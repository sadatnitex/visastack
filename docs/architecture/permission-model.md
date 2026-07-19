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
6. Expired/revoked access (grant or membership) fails the **next** server
   request — no cached allow.
7. Recipient acceptance is required for a grant to take effect.
8. Support/admin access is **not** an ordinary role permission — it is
   just-in-time, reasoned, approved, time-limited, and visible to the
   applicant.

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
