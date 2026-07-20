# ADR-0011: Zero-dependency storage (Neon-bytea) and structural scanner

- **Status:** Accepted
- **Date:** 2026-07-20
- **Deciders:** VisaStack engineering
- **Spec link:** Build Spec §6, §7; PRD §3.

## Context

The document pipeline was built against provider-agnostic ports (`StoragePort`,
`BlobStore`, `ScannerPort`; ADR-0010) so the real backends could be chosen
later. The operator wants the system fully functional **without provisioning
AWS (S3/KMS) or running a ClamAV service** — using only the infrastructure
already in place (Vercel + Neon).

## Decision

- **Storage = Neon-bytea (`@visastack/adapters` → `NeonBlobStorage`).** Object
  bytes are stored in a `storage_blobs` table keyed by an opaque object key
  (never the display filename; Build Spec §7). Encryption at rest is provided by
  Neon. Access is issued as a short-lived **HMAC-signed URL** to an in-app
  serving route (`/api/blob/[key]`); the token is the capability, minted only
  after the policy engine authorized the access in `previewDocument` /
  `downloadDocument`. The serving route re-verifies signature + expiry.
- **Scanner = built-in structural validator (`BasicSafetyScanner`).** Reads the
  stored bytes and enforces a positive allow-list of document magic bytes
  (PDF/PNG/JPEG) plus size limits, rejecting executables and unrecognized
  content. It runs in-process, no daemon, no signatures DB.
- Both satisfy the existing ports, so the domain, its guarantees, and all tests
  are unchanged. Swapping to S3+KMS / ClamAV later is an adapter change only.

## Consequences

- **Positive:** the full upload → scan → store → permissioned-serve flow works
  end-to-end on Vercel + Neon alone, with no external accounts or keys. Proven
  by an integration test that drives real PDF bytes to `AWAITING_REVIEW` and an
  executable to `NEEDS_ATTENTION`.
- **Accepted risks / trade-offs (explicit, not hand-waved):**
  1. **The structural scanner is NOT antivirus.** It stops type-spoofing and
     obvious executable/malware-shaped uploads, not signature-based threats. It
     is paired with the human-approval gate (documents never auto-promote to
     shared/clean without owner confirmation). The Phase 6 AV/pentest gate stays
     **open** until a real ClamAV adapter is wired.
  2. **Postgres is not object storage.** `bytea` is fine for the current
     document sizes but adds DB size/IO pressure at scale; large files and high
     volume should move to S3 behind the same `BlobStore`.
- **Reversible:** set the operator's S3/KMS + ClamAV env and swap the two
  adapter classes; no schema or domain change (the `storage_blobs` table simply
  goes unused).

## Alternatives considered

- **Require S3/KMS + ClamAV now** — rejected per the operator's constraint; the
  ports exist precisely so this isn't required.
- **Public multi-scanner APIs (VirusTotal/Cloudmersive)** — rejected: they share
  uploaded samples, which is unacceptable for private immigration documents.
- **Vercel Blob** — viable and better for large files, but the operator chose
  Neon-bytea to avoid enabling any additional Vercel feature; Blob remains a
  drop-in `BlobStore` if that changes.
