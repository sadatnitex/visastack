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
- Object storage, KMS/key service: existing vendor to confirm/extend (see
  `docs/adr/0011-neon-bytea-storage-and-structural-scanner.md`), not assumed to require a new
  vendor.
