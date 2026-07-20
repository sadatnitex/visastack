# Delivery Plan

This plan follows the authoritative delivery sequence in **Build Spec §20**
and **PRD §18**. Phases are named by their spec title to avoid off-by-one
confusion (the Build Spec numbers them 0–5; the PRD numbers them 1–6 — same
content). Each phase ends at a **gate**: it does not reach production until
its acceptance criteria (see [`acceptance-criteria.md`](acceptance-criteria.md))
pass.

**Definition of Done (PRD §18):** implemented, tested, documented,
observable, supportable, reversible, and proven against acceptance
criteria — *not merely deployed.*

---

## Foundation — *Trust foundation* (Spec Phase 0 / PRD 1)

Threat model, data classification, canonical schema, authentication, policy
engine, audit, private storage, environments, and CI.

- [x] Monorepo, strict TypeScript, Universal Core seam, CI, governance,
  docs spine, security scanning *(delivered in PR #1 — a subset)*.
- [ ] Threat model + data-classification matrix approved.
- [ ] Canonical Drizzle schema (`FieldDefinition`, `FactVersion`,
  `Document`/`DocumentVersion`/`StorageObject`, `Mission`, `Grant`,
  `Organization`, `AuditEvent`, …) with reviewed, reversible migrations.
- [ ] WorkOS AuthKit wired; VisaStack policy engine authoritative,
  default-deny, fail-closed audit.
- [ ] Append-only audit sink; private S3 quarantine/clean buckets + KMS.
- [ ] Neon production branch protected; synthetic-only preview branches.

**Gate:** tenant-isolation + permission-matrix tests pass; audit fails
closed; no production data in preview; threat model approved.

## Applicant Core (Spec Phase 1 / PRD 2)

- [x] Account + separated consents (core / AI / sharing / marketing)
  *(`@visastack/services`: `provisionAccount`, `setConsent`/`getConsents`)*.
- [x] Applicant, family member, and authorized minor/guardian records
  *(consent-gated `createApplicant` / `addFamilyMember`)*.
- [x] Master Profile: canonical + repeating records, manual editing with
  immutable `FactVersion` history and provenance *(policy-authorized,
  atomically-approved `editFact`; no silent mutation)*.
- [x] Document Vault metadata; permission-aware preview/download
  *(`registerDocument`/`addDocumentVersion`; policy-gated
  `previewDocument`/`downloadDocument` via a `StoragePort` seam; step-up for
  originals)*.
- [x] Account export + deletion workflow *(`exportAccount` full snapshot;
  `requestAccountDeletion`/`cancelAccountDeletion`/`executeAccountDeletion`
  with a reversible grace window; audit preserved verbatim on erasure)*.

**Gate:** 100% of profile mutations require authorized approval or manual
edit; export/deletion passes; no-AI manual path fully usable. **→ MET.**

*Progress:* the no-AI manual path and the permission-aware Document Vault are
implemented and proven (every mutation and access is policy-authorized,
consent-gated, and audited atomically — see ADR-0009). Remaining before the
gate closes: the account export/deletion workflow.

## Document Intelligence (Spec Phase 2 / PRD 3)

- [x] Safe upload pipeline: quarantine → scan → normalize → extract
  *(`processIntake` state machine; idempotent, resumable transitions; unsafe
  scans routed to NEEDS_ATTENTION; `ScannerPort` seam)*.
- [x] Deterministic parsing first *(TD3 passport MRZ with ICAO check-digit
  validation + date parsing; `parseTd3`)*; embedded text/tables extend later.
- [x] Field proposals via the AI Gateway; atomic approval transaction; cost
  controls *(`AiExtractionPort` → `FieldProposal[]`; `runExtraction` is
  consent- and budget-gated and never mutates; `approveProposal` reuses
  `editFact` for an immutable, provenance-tagged approval — no silent mutation,
  no invented fields)*. The concrete GPT-5.6 Terra adapter is deferred behind
  the port until keys exist; correction-feedback learning is a later slice.

**Gate:** AI/document benchmark met (≥95% type accuracy, ≥95% identity/date
precision, ≥90% filename accepted unedited); no silent mutation; no
unsupported field ID persisted.

*Progress:* the pipeline, deterministic MRZ parsing, and the propose→approve
AI path are implemented and proven (see ADR-0010). The "no silent mutation"
and "no unsupported field ID" invariants are enforced and tested; the accuracy
benchmark is measured once the real model adapter is wired. **Storage and
scanning are now wired with zero external dependencies (ADR-0011):**
`@visastack/adapters` provides a Neon-bytea `NeonBlobStorage` (signed in-app
serving at `/api/blob/[key]`) and a built-in `BasicSafetyScanner`, proven
end-to-end (real PDF → `AWAITING_REVIEW`, executable → `NEEDS_ATTENTION`). Real
S3+KMS / ClamAV / OpenAI adapters swap in behind the same ports; the AV +
accuracy gates stay open until then.

## Missions & Packs (Spec Phase 3 / PRD 4)

- [x] Pack Studio; cited, versioned, admin-approved requirement packs
  *(`createPack`/`addPackVersion`/`addRequirement` (citation-required) →
  `approvePackVersion` (freezes manifest + sha256 checksum) →
  `publishPackVersion`; content immutable once out of DRAFT)*.
- [x] Parallel Mission Workspaces; readiness (no approval probability);
  reviewer workflow *(`createMission`, `attachPackVersion` (PUBLISHED only),
  `computeReadiness` (completeness only), guarded `transitionMission` state
  machine)*. Grounded letters/translations remain a later slice.
- [x] Immutable mission snapshots *(`snapshotMission`: checksummed,
  sequential, never mutated)*.

**Gate:** snapshot regression tests pass; readiness never shows approval
likelihood; pack manifest/checksums verified.

## Agencies & Sharing — *Collaboration* (Spec Phase 4 / PRD 5)

- [x] Organization verification (`PENDING_VERIFICATION` → `ACTIVE` …);
  no self-upgrade to provider *(`createOrganization`, `reviewOrganization`
  (independent reviewer), `suspendOrganization`, membership management)*.
- [x] Scoped/accepted/time-limited grants + access transparency
  *(`createGrant`/`acceptGrant`/`revokeGrant`/`pause`/`resume`,
  `listAccessForApplicant`; end-to-end with the policy engine)*.
- [x] Assignments, notes, evidence requests, permissioned bulk export
  *(`assignMember`, `addNote`, `requestEvidence`/`respondEvidence`, and
  `bulkExport` — policy-engine-gated, only EXPORT_PROFILE-granted applicants
  included)*.

**Gate:** grants are accept-required, purpose-bound, revocable next-request;
membership never exposes records; bulk export permission-checked.

## Retention & legal hold (PRD 5 — cross-cutting)

- [x] Retention policies per document type + eligibility-based purge that never
  touches held data *(`setRetentionPolicy`, `documentsPastRetention`,
  `purgeExpiredDocuments`)*.
- [x] Legal hold that **overrides deletion** *(`placeLegalHold` /
  `releaseLegalHold`; `executeAccountDeletion` refuses while any active hold
  exists on the account's applicants)*.

## Controlled Launch (Spec Phase 5 / PRD 6)

- [ ] Internal synthetic testing → Travel Router real-data pilot →
  selected agencies → public travelers *(needs the wired adapters + rollout)*.
- [~] Availability/perf/RPO/RTO, restore drill, WCAG 2.2 AA, English/Bangla,
  incident runbook — **partly delivered:** English/Bangla message catalog
  (`@visastack/i18n`, fallback + interpolation), liveness (`/api/health/live`)
  + readiness probes, and the incident runbook + RPO/RTO/restore-drill docs
  (`docs/operations/`). Remaining: WCAG 2.2 AA (needs the UI), live
  availability/perf monitoring, and executing the restore drill.

**Gate:** benchmarks, recovery, and **external penetration test** pass with
no unresolved Critical/High; accessibility + English/Bangla critical paths
pass; migration/rollback/smoke green. *(The pentest and AI/document accuracy
benchmarks require the external adapters — S3+KMS, ClamAV, OpenAI Terra — to be
wired with the operator's keys; they remain open until then.)*

---

## Deferred but architecture-compatible (Build Spec §21)

Employer / law-firm / service-provider portals, corporate mobility, official
form completion, appointment intelligence, settlement pathways, non-approval
predictive intelligence, marketplace/integrations, native mobile. **None may
bypass the canonical evidence, permission, audit, and snapshot model.**
