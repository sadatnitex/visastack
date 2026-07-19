# Canonical Data Model

Spec-faithful reference for the canonical entities. Authority: Build Spec
§4, §8, §9; PRD §8–9. Neon PostgreSQL is the **only** canonical writable
store (Build Spec §15); Drizzle ORM with reviewed, reversible migrations.

> Principle: **facts are immutable and append-only.** The "current value" of
> any field is a *pointer* to an immutable `FactVersion`. Nothing is ever
> silently overwritten (Build Spec §9, §0.7).

## Identity & tenancy

- **Account** — a login (WorkOS-backed). Owns nothing by itself.
- **Applicant** — the record owner / subject. An Account may own several
  (self, family member, authorized minor). Relationship + authority recorded.
- **Organization (Agency)** — status `PENDING_VERIFICATION` → `ACTIVE` →
  `SUSPENDED` / `REJECTED` / `CLOSED`. Cannot self-upgrade. Membership never
  exposes applicant records (Build Spec §2).
- **Membership** — Account ↔ Organization with role (`OWNER`, `ADMIN`,
  `CASE_MANAGER`, `REVIEWER`). Roles do **not** grant resource access;
  access always comes from an applicant/mission-scoped `Grant`.

## Master Profile

- **FieldDefinition** — canonical field: data type, validation, sensitivity,
  applicability, pack ownership, allowed evidence types, display + staleness
  rules. AI may only use field IDs from this registry; org custom fields are
  namespace-scoped until formally promoted (Build Spec §4.1, §8).
- **Fact** — logical field instance for an applicant (single or one of a
  repeating record). Holds a pointer to the current `FactVersion`.
- **FactVersion** — immutable value + full change metadata (actor, role,
  method, reason, source evidence, mission context, model/prompt/schema
  versions). Statuses: `Declared`, `Extracted-Pending`,
  `Applicant-Confirmed`, `Document-Supported`, `Agency-Reviewed`,
  `Conflicted`, `Stale`, `Superseded`. Generic `Verified` is forbidden.
- **RepeatingRecord** — a grouping (e.g. a specific passport, employment,
  address) that owns a set of Facts.

## Document Vault

- **Document** — the logical item (approved display name, subject, type…).
- **DocumentVersion** — an uploaded or generated version.
- **StorageObject** — the encrypted bytes in S3. Key is an immutable UUID,
  **never** the display filename. Original bytes are immutable and private.
- **DocumentNameVersion** — each approved display name, with actor/reason/
  time (renames are versioned, never destructive) (Build Spec §7).
- **EvidenceLink** — associates a `DocumentVersion`/page/region to a
  `FactVersion` as supporting evidence (may exist without changing a fact).

## Missions

- **Mission** — destination/route/purpose workspace. States: `DRAFT`,
  `IN_PROGRESS`, `READY_FOR_REVIEW`, `UNDER_REVIEW`, `READY_TO_EXPORT`,
  `LOCKED`, `CLOSED`, `CANCELLED`. Parallel missions are first-class.
- **RequirementPack / Requirement** — cited, versioned, admin-approved (see
  [pack architecture](#) / Build Spec §5). A mission pins specific versions.
- **MissionSnapshot** — immutable capture of the exact fact/document/
  requirement versions and generated outputs at lock time. Later Master
  Profile edits never mutate a prior snapshot (Build Spec §9).
- **GeneratedOutput** — letters/translations/packs; evidence-grounded,
  require human approval; regeneration creates a new version.

## Access & audit

- **Grant** — dimensions: owner applicant, recipient (person/org),
  relationship, mission, category/document, action, purpose, start, expiry,
  constraints. Recipient acceptance required; pause/revoke/expire effective
  on the **next** request. Never creates ownership or a hidden copy.
- **AuditEvent** — append-only, tamper-evident. Restricted operations
  **fail closed** if the required audit record cannot commit (Build Spec §14).
- **ConsentRecord** — separate records for core processing, AI-assisted
  extraction, sharing/delegation, and marketing/case-study.

## Timestamps (UTC stored, locale displayed — Build Spec §9)

`createdAt`, `observedAt`, `proposedAt`, `approvedAt`, `effectiveFrom`,
`validUntil`, `lastConfirmedAt`, `updatedAt`, `supersededAt`.

## Invariants (enforced in the service layer + tested)

1. A field's current value is always a pointer to an immutable `FactVersion`.
2. No `FactVersion`, name change, or approval persists without authorized
   approval or explicit manual edit (acceptance gate: 100%).
3. Approval of a document's name + selected facts + evidence links + audit
   event is **one transaction**; partial failure commits nothing (Build Spec §8).
4. A `StorageObject` key never changes on rename.
5. Row/object authorization is enforced in the service layer for every
   resource and tested for cross-tenant isolation.
