# Master Profile enrichment: architecture findings

Read-only findings from the 2026-10-14 investigation. Each item names the file so it can be re-checked. Line numbers drift; search by name.

## 1. How a profile value is stored

- `packages/db/src/schema.ts`: `fieldDefinitions` (key, label, sensitivity, pack), `facts` (one per subject and key, with `currentVersionId`), `factVersions` (append only history).
- `packages/services/src/profile.ts`: `registerFieldDefinition` registers a definition lazily and the first writer wins; `editFact` writes a new version.
- SENSITIVE and RESTRICTED values are AES-256-GCM encrypted (`protected-fields.ts`, envelope keys, additional authenticated data bound to the record). Protection is part of a field's identity.

## 2. Where the field list lives

- `apps/web/src/lib/profile-fields.ts`: 81 fields. Packs: universal (18 single fields plus 7 groups), professional, business, medical, medical attendant.
- `profile-sections.ts` groups fields for screens. `labels.ts` has `DOCUMENT_TYPE_LABELS` with only 3 entries.
- `packages/core/src/domain.ts`: `PROFILE_PACKS`, `FACT_STATUSES`.

## 3. Packs versus layers

- A pack is a sharing category. Grants validate their categories against `PROFILE_PACKS` (`packages/services/src/sharing.ts`, with `DOC_TYPE_TO_PACK` and `documentCategory`).
- A layer is presentation only (how screens group things). New layers must not add pack names, or sharing grants change meaning.

## 4. Documents

- `classification.ts`: `KEYWORD_RULES` and `CLASSIFIABLE_DOCUMENT_TYPES` decide the type from file content.
- Pack requirements and rule packs name document types as free text. `packs.ts` `addRequirement` does no key validation.
- bidesh365 has 114 stored document types and 137 scanner types, folded to fewer on upload; the curated VisaStack list will keep aliases for those names.

## 5. AI extraction

- `ai.ts` allowed keys (around line 1096) and the Gemini and OpenAI adapters (`gemini-extraction.ts`, `openai-extraction.ts`) put every registered key into every prompt. Growing the registry without scoping per document type raises cost, lowers accuracy and enlarges the surface for wrong suggestions.
- A person always approves suggestions. That rule stays.
- `packages/adapters/src/eval/dataset.ts` is the evaluation set; it must be re-run when allowed keys change.

## 6. Trust and evidence (already built, reuse it)

- Evidence links, conflicts (`conflicts`, `documentInconsistencyFlags`), assurance ladder E0 to E3 (`assurance.ts`), wallet and supersede (`wallet.ts`), issuer verifications, contributor requests.
- Expiry Centre with 90, 60, 30, 7 and 0 day ladder (`expiry.ts`, `documentExpiryPolicies`).
- `notification-sweep.ts` `sweepExpiryReminders` reads `documents.expiresAt` (not superseded) and `issuerVerifications.validUntil`. Delivery is in-app and email, idempotent per threshold, linking to the expiry page. An expired document invalidates live acknowledgements on missions that select it. A typed `passport_expiry` fact is not swept.

## 7. Readiness and rules

- `missions.ts` `computeReadiness` and `rule-conditions.ts` reference field keys and document types by exact text. Renames must go through the catalogue with an alias table, never a silent edit.

## 8. Constraints that shape the plan

| Constraint | Consequence |
|---|---|
| First-writer-wins registration | Catalogue is the source of truth; registration reads it. A guard freezes the 81 legacy keys with exact pack, sensitivity and type |
| Exact-text matching in rules and requirements | Aliases and a validation step in Phase 2 |
| Prompt carries all keys | Scope allowed keys per document type before growth |
| Packs drive sharing | New groupings are layers, not packs, unless sharing semantics are intended |
| Household | Built on the several-applicants feature with IAM-04 separate-subject authorisation |
| Controlled pilot | No real data, no production migration without a specific go |
| Guards | Biome, flat design, route navigation, inline-style ratchet (baseline 494), plain language, accessibility, type scale |

## 9. Not verified

Whether bidesh365 runs, its stored data, the contents of stored country rule packs, the exact reach of fact-level sharing to organisations, AI evaluation behaviour with a larger key set, and the legal wording of declarations.

## 10. Findings added during Phase 1 (2026-10-14)

- **Document categories are narrower than they look.** `DOC_TYPE_TO_PACK` in `sharing.ts` maps only Passport, Bank Statement and Employment Certificate. Every other type has no category and is invisible to category grants. Deriving the map from the catalogue in Phase 2 makes many more documents reachable by grants that include their pack. That is a privacy-relevant change and needs a per-type review first.
- **The live refusal record sits in the universal category.** `visa_refusal` (including `refusal_reason`, SENSITIVE) is in `universal`. The new declarations category would be safer, but moving it changes who a universal grant can see. Decide in Phase 2.
- **bidesh365 folds distinct documents into nearby types** (for example a fixed deposit receipt and a savings certificate become a bank statement; a refugee document becomes a passport). VisaStack stores `docType` as free text, so no fold is needed. The catalogue keeps them distinct and records only exact duplicates as aliases.
- **bidesh365 stores variants of the same record twice** (education, police clearance, good conduct and legal clearances, passport lists). The catalogue merges them into one record each.
- **The other product stores links to uploaded files as fields** (dozens ending in `_url`). VisaStack links a document to a fact through proof links, so none were ported.
- **Raw biometrics are not ported.** Only the record of an appointment is stored.
- **RESTRICTED values already need an explicit approval to be sent to a model** (`ai.ts`). New RESTRICTED fields inherit that, which is the intended safety net.
- **Field keys per document type are the missing piece for AI extraction.** Each document type now lists the fields it `supports`; Phase 2 can use that to scope the allowed keys in the extraction prompt instead of sending every registered key.
