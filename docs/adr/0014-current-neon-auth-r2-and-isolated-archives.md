# ADR-0014: configured Neon Auth, R2 and isolated encrypted database recovery

2026-10-11. Status: records implemented configured deployment choices; full public-beta acceptance remains blocked.

Production selects Neon Auth explicitly, while the existing legacy WorkOS path remains available only according to provider selection. Immutable identity continuity and existing roles are retained; email matching or password recovery does not authorize an account transfer.

Private R2 is the configured document and archive store through the existing S3-compatible boundary. Force path-style access and use the account's EU jurisdiction endpoint with region auto. Vercel/Neon storage adapters remain alternatives, not evidence that production still stores its originals there. Structural file validation is not antivirus and cannot authorize sensitive-data intake by itself.

Database captures use pg_dump on Actions, archive encryption and private R2 upload. Run 38128672220 proved authenticated download/decryption and database-only restore into a private temporary PostgreSQL service. There was no production database connection in that restore. Document objects, application keys, audit checkpoints, tombstones, revoked access and complete measured RPO/RTO are outside the proven result.

Application email is separate from Neon Auth SMTP. Provider acceptance and configuration presence do not prove delivered branded mail, signed receipt reconciliation or inbox placement. Manual case preparation remains available if approved AI is unavailable. Actual costs and free capacity must be measured, and founding access remains complimentary.

This record supersedes older operational provider assumptions where they conflict; it does not erase earlier ADRs, reduce acceptance targets, authorize production migrations or open real-data registration/intake. Use [current operating guidance](../operations/current-platform.md) and [release acceptance](../public-beta/RELEASE-ACCEPTANCE-CHECKPOINT.md).
