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

- [ ] Safe upload pipeline: quarantine → scan → normalize → extract,
  isolated workers, recoverable failures.
- [ ] Deterministic parsing first (MRZ, embedded text, tables, dates).
- [ ] GPT-5.6 Terra classification / naming / field proposals via the
  AI Gateway; atomic approval transaction; correction feedback; cost
  controls.

**Gate:** AI/document benchmark met (≥95% type accuracy, ≥95% identity/date
precision, ≥90% filename accepted unedited); no silent mutation; no
unsupported field ID persisted.

## Missions & Packs (Spec Phase 3 / PRD 4)

- [ ] Pack Studio; cited, versioned, admin-approved requirement packs.
- [ ] Parallel Mission Workspaces; readiness (no approval probability);
  reviewer workflow; grounded letters/translations; versioned pack
  generation with manifest/checksums.
- [ ] Immutable mission snapshots.

**Gate:** snapshot regression tests pass; readiness never shows approval
likelihood; pack manifest/checksums verified.

## Agencies & Sharing — *Collaboration* (Spec Phase 4 / PRD 5)

- [ ] Organization verification (`PENDING_VERIFICATION` → `ACTIVE` …);
  no self-upgrade to provider.
- [ ] Assignments, scoped/accepted/time-limited grants, access
  transparency, notes, evidence requests, permissioned bulk export.

**Gate:** grants are accept-required, purpose-bound, revocable next-request;
membership never exposes records; bulk export permission-checked.

## Controlled Launch (Spec Phase 5 / PRD 6)

- [ ] Internal synthetic testing → Travel Router real-data pilot →
  selected agencies → public travelers.
- [ ] Availability/perf/RPO/RTO, restore drill, WCAG 2.2 AA, English/Bangla,
  incident runbook.

**Gate:** benchmarks, recovery, and **external penetration test** pass with
no unresolved Critical/High; accessibility + English/Bangla critical paths
pass; migration/rollback/smoke green.

---

## Deferred but architecture-compatible (Build Spec §21)

Employer / law-firm / service-provider portals, corporate mobility, official
form completion, appointment intelligence, settlement pathways, non-approval
predictive intelligence, marketplace/integrations, native mobile. **None may
bypass the canonical evidence, permission, audit, and snapshot model.**
