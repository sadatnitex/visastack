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

- **Transactional email provider (Part 5, NTF-03): Resend.** Official docs: resend.com/docs
  (direct fetch blocked by this environment's network egress proxy this session; verified via
  the official `resend` npm package's registry metadata -- a primary source, current version
  6.28.1, Node >=20 -- plus multiple independently cross-referenced search results for pricing
  and compliance facts; see `docs/adr/0013-transactional-email-resend.md` for full sourcing
  notes). Pricing: Free tier 3,000 emails/month (100/day cap); Pro $20-35/mo; Scale $90
  (100k)-$1,150 (2.5M emails). No licensing/per-seat cost beyond send volume. Region: a
  sending region is selectable (e.g. `eu-west-1`) but controls only where the outbound SMTP
  hop originates -- account data (message content, delivery logs, webhook payloads, account
  records) is stored in the US regardless of sending region; no EU data-residency option
  exists. Data terms: SOC 2 Type II, GDPR (DPA + SCCs), EU-US Data Privacy Framework;
  included on every tier, including Free. Deployment shape: a single `fetch` call to
  `POST https://api.resend.com/emails` (`packages/adapters/src/email.ts`'s `ResendEmailPort`)
 -- no SDK dependency, matching this codebase's other adapters' footprint -- plus a
  Svix-signed (HMAC-SHA256) webhook receiver (`apps/web/src/app/api/webhooks/resend/route.ts`)
  for delivery/bounce/complaint confirmation. Chosen over Postmark (the directive's named
  seven criteria applied in full in the ADR): Postmark's free tier is 100 emails/month
  (30x smaller) and its webhook model is HTTP Basic Auth + IP allowlisting rather than a
  cryptographic HMAC signature -- a materially weaker guarantee against a forged webhook
  request. **Open item:** no real Resend account/API key/webhook secret exists in this
  sandbox; live synthetic delivery + signed-webhook verification (directive A18) is BLOCKED
  until one is provisioned, tracked in `known-issues.md`. Review date: 2026-09-22 (this
  session).

## Candidates, not yet selected

Anticipated from the directive itself, to be filled in when each part actually selects a
vendor:

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
