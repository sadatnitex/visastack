# Commercial V1 Cost and Vendor Register

Tracks every external vendor/API this programme adds or changes, per Part 1 Section 11:
official docs URL and review date, pricing basis, region, data terms.

No entries yet. Candidates anticipated from the directive itself, to be filled in when each
part actually selects a vendor:

- Malware scanning engine (Part 3): ClamAV (self-hosted/isolated worker) versus an approved
  private scanning service.
- Transactional email provider (Part 5): choice deferred to that part, lowest-complexity
  option meeting the directive's criteria.
- AI providers (Part 8): OpenAI, Google Gemini, Anthropic; three adapters required.
- Object storage: existing vendor to confirm/extend (see
  `docs/adr/0011-neon-bytea-storage-and-structural-scanner.md`), not assumed to require a new
  vendor.
- KMS/key service (Part 2, SEC-03): no live account exists this session. The
  `KeyManagementPort` interface (`packages/services/src/ports.ts`) is vendor-agnostic by
  design, so this is purely a "which adapter to write" decision, not an architecture one.
  Candidates to evaluate against official current docs when a real account is provisioned:
  AWS KMS (natural fit if the rest of the stack moves toward AWS/S3 per ADR-0011's own
  "S3+KMS" future swap-in note), GCP KMS, or a Vercel-integrated secret/KMS offering if one
  exists and meets the envelope-key requirements. Record pricing, region, and API review date
  here once chosen. Until then, live KMS verification stays BLOCKED per
  `known-issues.md` item 14.
