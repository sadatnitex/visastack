# Commercial V1 Cost and Vendor Register

Tracks every external vendor/API this programme adds or changes, per Part 1 Section 11:
official docs URL and review date, pricing basis, region, data terms.

## Chosen

- **Malware scanning engine (Part 3): ClamAV.** Official project: clamav.net, source
  `github.com/Cisco-Talos/clamAV` (Cisco Talos). Pricing: free, open source (GPLv2), no
  licensing cost at any scale. Deployment shape: self-hosted daemon (`clamd`), reached over a
  Unix socket (same-host/sidecar isolated worker) or TCP (a separately-hosted worker), never a
  hosted third-party scanning API, so no per-scan vendor cost and no document bytes ever leave
  infrastructure this operator controls. Signature updates: `freshclam`, pulling from ClamAV's
  own CDN (`database.clamav.net`), free, no account/API key required. Data terms: N/A, nothing
  is sent to Cisco Talos; only signature *downloads* occur outbound, not document uploads.
  Chosen over "an approved private scanning service" (the directive's named alternative)
  because it meets every stated requirement (real engine, PDF-capable via `ScanPDF`, signature
  freshness tracking, isolated-worker-compatible) at zero incremental vendor cost and with no
  new data-sharing relationship to vet, and this session could genuinely install, run, and
  live-verify it end-to-end (see `architecture-decisions.md` AD-04), which a hosted API this
  session has no account for could not offer. Review date: 2026-09-16 (this session).
  **Open cost/ops item:** production hosting for the actual isolated worker process (a small
  persistent VM/container, since ClamAV needs a long-running daemon, not a serverless
  invocation) is not yet chosen or costed, tracked under `architecture-decisions.md` AD-04's
  "what remains open," item 2.

## Candidates, not yet selected

Anticipated from the directive itself, to be filled in when each part actually selects a
vendor:

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
