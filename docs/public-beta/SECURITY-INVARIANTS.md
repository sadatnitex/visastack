# Public-beta security invariants

2026-10-11. These are retained implementation and acceptance boundaries, not a claim that final beta verification passed.

- A trusted immutable identity and the reviewed continuity rules establish account access. An email match, verification link or password reset does not transfer existing records or platform roles.
- Platform administration stays behind current platform-role checks. Legacy identifier reports do not grant privileges or require a working Neon account to adopt WorkOS.
- Cross-tenant access requires current ownership or accepted scoped grants and membership/assignment rules. Revocation and retention restrictions apply at the action, not only when a page loaded.
- Documents remain private and follow the existing quarantine, scanner and processing boundaries. Signatures and structural checks are not antivirus. Real sensitive-data intake remains disabled pending operational acceptance.
- Optional AI requires the actual selected configuration, consent, privacy approval, budget and human review. Its absence must not break manual case preparation.
- Queued work is durable; provider acceptance is distinct from delivery. Missing providers, expired/replaced leases and unavailable workers must not manufacture success. Signed receipt and scheduler acceptance remain required.
- Public readiness stays coarse; provider secrets, keys and detailed operational diagnostics remain private.
- An encrypted backup is not a verified full restore. Database-only recovery is proven separately; files, keys, audit checkpoints, tombstones and revoked access remain required for full recovery.
- Production migrations, restores, account reassignment, paid activation and final sensitive-data release require their applicable explicit authorization. Ordinary verified UI/service releases do not imply those actions.
- Founding access remains complimentary, provider upgrades retain account/domain identities, and missing capacity readings are unavailable rather than zero.

Use [current operating guidance](../operations/current-platform.md), [release acceptance](RELEASE-ACCEPTANCE-CHECKPOINT.md) and the original governing requirements for evidence and outstanding closure.
