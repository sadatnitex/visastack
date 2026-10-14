# Master Profile enrichment: implementation plan

Every phase is small, reversible and ends in something that can be checked. Pause for the owner after Phase 1.

## Principles

1. One catalogue is the source of truth for purposes, documents and fields. Everything else reads from it.
2. Additive first: no key, pack, sensitivity or type of the 81 legacy fields changes.
3. Stable keys, aliases for renames, never reuse a retired key.
4. Protection never goes down. Identifiers get the strongest level.
5. Lists stay extendable: adding an entry is one catalogue edit plus a regenerated report.
6. Display labels in Title Case for terms; sentences in standard practice.
7. Traceable: every catalogue entry can carry its source (bidesh365 name, owner decision) and a change note.

## Phase 1: foundations (no screens, no database migration, no behaviour change)

1. `packages/core/src/catalogue/` with types and conventions (`types.ts`, `README`-style header comment).
2. `purposes.ts`: the 101 purposes, each with a key, label, group and handling (normal or adviser only).
3. `documents.ts`: curated document types with key, label, group, pack, aliases and folds from bidesh365's lists, validity and legalisation hints, and which field keys they can fill.
4. `fields.ts`: new fields with key, label, layer, pack, protection, data type, applicability and (for documents) the fill relationship.
5. Guard tests: unique keys; legacy 81 keys frozen with exact pack, sensitivity and type; label casing; identifiers protected; every fill references a real key; aliases never collide; pack names are valid `PROFILE_PACKS`.
6. A generated review report (markdown) and a drift test that fails when the report and catalogue disagree.
7. Ledger row (PRO-01 enrichment, owner decision 2026-10-14) and a known-issues entry.
8. Prove each guard can fail by breaking the real data temporarily.

Staging: docs PR first, then catalogue foundation plus purposes plus documents, then fields.

Exit: lint, typecheck, tests green; report reviewed by the owner.

## Phase 2: wiring (after the owner confirms)

- Derive the legacy field registry from the catalogue.
- Derive `DOC_TYPE_TO_PACK` and the classification lists from the catalogue.
- Scope allowed extraction keys per document type; re-run the AI evaluation set.
- Validate requirement and rule keys against the catalogue (admin pick-lists).
- Decide up-front field registration against lazy first-writer-wins.

## Phase 3: screens for the new layers

Editor sections, document pickers and purpose chooser, each previewed first.

## Phase 4: country packs

Schengen, US, UK, Canada, Gulf, Australia, each with cited, approved rule packs.

## Phase 5: household and sponsor views

On the several-applicants feature with IAM-04 limits.

## Separate visible change

Title Case for the 81 existing labels (and the `'Passport number'` test assertion). Preview first.

## Risks and answers

| Risk | Answer |
|---|---|
| Catalogue drifts from legacy registry | Frozen-key guard and drift test |
| Prompt size grows | Per document type scoping in Phase 2 |
| Renamed key breaks a rule | Aliases and requirement validation |
| Sensitive wording is wrong in law | Structure only; wording held for the adviser |
| Concurrent edits by Codex and Claude | Protocol and claimed areas in `HANDOFF.md` |
