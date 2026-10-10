# Signup disclosure and submission safeguards

Continuation of public beta PR-02 and PR-03, following the verified PR #184 deployment.

The signup form links public versioned terms and privacy notices. A required checkbox is checked again on the server; bypassing browser validation cannot create an account without acknowledgement. The notices describe current pilot limits, configured identity, Vercel/Neon storage, email providers, optional-purpose separation and existing privacy controls. They do not claim legal review or invent a support channel, guaranteed location, backup certification or completed public beta.

Each form carries a purpose-separated HMAC signature using the existing protected Neon cookie key. It expires after twenty minutes. The submission rejects altered signatures, outdated versions and the hidden automation trap. After existing email/network throttles, one atomic database transaction consumes a nonce and appends an immutable notice acknowledgement before the provider is called. A database/audit failure blocks account creation and email sending. The nonce counter is pinned to the expiration window, so crossing midnight or pruning cannot reopen a live form. No new schema, key rotation or paid service is introduced.

The record is explicitly an unauthenticated signup-form acknowledgement with identityVerified=false. It stores notice versions and a random form ID, not email, password, marketing consent or fabricated verified identity. Acknowledgement survives a provider failure as the submitted declaration; it does not claim an account was created. Verified account linkage and acceptance of later notice revisions remain separate work.

These are baseline automation protections, not a CAPTCHA or proof that all bots are excluded. Public registration remains controlled by the existing PUBLIC_BETA_OPEN setting, which this change does not alter. Real applicant intake remains gated. Managed challenge configuration, shared provider allowance evidence, actual delivery, legal review/contact ownership and authenticated acceptance remain outstanding.

Verification: focused and full checks are pending at this implementation checkpoint. Provider selection for scanning, keys and backups remains deferred by the owner.

## Focused verification

The corrected focused runs passed all five database tests and 25 web tests. The initial database fixture referred to the wrong consent table and the plain-Node signing tests initially imported the SDK's Next-specific request context. The fixture now uses consentRecords, and those unit tests substitute the inert SDK constructor while retaining actual settings and cryptographic code. No security assertions were removed. Removing the acknowledgement guard made its hostile form test fail; removing the atomic replay decision made the midnight/pruning replay test fail. Both guards were restored. Shared full verification remains in progress.
