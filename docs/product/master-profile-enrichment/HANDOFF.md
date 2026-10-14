# Master Profile enrichment: handoff record

Living, append-only record for everyone who works on this programme (the owner, Claude sessions, Codex). Read this before touching profile fields, document types, purposes, packs, extraction keys or the catalogue. Add to it at the end of every work session. Never rewrite earlier entries; add a dated correction instead.

## Status at a glance (updated 2026-10-14)

| Item | State |
|---|---|
| Gap analysis against bidesh365 | Done, recorded in `docs/product/master-profile-gap-analysis-2026-10-14.md` (PR 213) |
| Architecture findings | Done, `ARCHITECTURE-FINDINGS.md` in this folder |
| Implementation plan | Done, `IMPLEMENTATION-PLAN.md` in this folder |
| Phase 1 (catalogue foundations, no screens, no migration, no behaviour change) | Not started. Next after this docs change merges |
| Phase 2 (wiring) | Not started. Waits for the owner to confirm after Phase 1 |
| Title Case for the 81 existing field labels | Separate visible change, to be previewed first |

## 1. What this programme is

One profile that serves any Bangladeshi, anywhere, for any travel or purpose (visit, study, work, residency, citizenship, sponsorship, medical, pilgrimage and more). The enrichment covers fields, documents, data and categories, and every list must stay extendable without a rewrite. Source of ideas: the bidesh365 master profile (read-only reference at `/home/user/bidesh365`, never edited from here).

## 2. Owner rules for this programme

- Power-first, production quality, no prototypes.
- Capitalisation: terms and stand-alone labels in Title Case (Passport Number, Date of Birth). Sentences follow standard practice. Buttons stay in sentence style (earlier rule). Small connecting words (of, and, for, to) stay lowercase inside a label. This is an assumption, to be confirmed.
- No em dashes anywhere. Plain wording in anything a user sees.
- Bangla and all translation work stays deferred.
- Six standing decisions (defaults the owner accepted by silence): keep all purposes with adviser-only handling for protection and investor routes; sensitive declarations are structure only now, wording is held for the adviser; Bangladesh pack in v1 with the strongest protection on identifiers; first country packs are Schengen, US, UK, Canada, Gulf, Australia; household builds on the existing several-applicants-per-account feature and respects the IAM-04 limits; Phase 1 produces exact curated lists for sign-off.
- Merge when green and report (table: Area | What changed | What you will see | Who notices; then Checked live / Not live yet / Not yet checked / Needs you).

## 3. What has been done, where, how and why

| Date | What | Where | Why |
|---|---|---|---|
| 2026-10-14 | Compared all 54 bidesh365 sections, documents and purposes with VisaStack | `docs/product/master-profile-gap-analysis-2026-10-14.md` | Numbers come from extracting both registries with the compiler, not from old planning notes |
| 2026-10-14 | Read VisaStack end to end for how fields, documents, packs, sharing, AI keys, rules, reminders and trust fit together | `ARCHITECTURE-FINDINGS.md` | The enrichment must plug into what exists, not beside it |
| 2026-10-14 | Wrote the staged plan | `IMPLEMENTATION-PLAN.md` | Phases are small, reversible and each ends in something checkable |

## 4. How to check the work

- Gap analysis: open the document, every count has a "how counted" note.
- Once Phase 1 lands: `pnpm --filter @visastack/core test` runs the catalogue guards, and a generated review report is checked in with a drift test that fails when the catalogue and the report disagree.

## 5. Key findings (short form, full text in ARCHITECTURE-FINDINGS.md)

- Field list is a hand-written registry of 81 fields in `apps/web/src/lib/profile-fields.ts`, registered lazily in the database on first edit (first writer wins).
- A pack is a sharing category that grants validate against. A layer is presentation only. Do not merge the two ideas.
- The AI extraction prompt carries every registered key, so the key list must be scoped per document type before the registry grows.
- Rule packs and requirements match field keys and document types by exact free text, with no validation. A renamed key silently breaks them.
- Reminders sweep document expiry dates and issuer verifications. A typed-in expiry fact is not swept.
- Sensitive and restricted values are encrypted per value; the protection level of a field is part of its identity and must never be downgraded.

## 6. Phases

Phase 1 foundations. Phase 2 wiring. Phase 3 screens for new layers. Phase 4 country packs. Phase 5 household and sponsor views. Detail and exit checks in `IMPLEMENTATION-PLAN.md`.

## 7. Decisions still waiting on the owner

- Confirm the Title Case assumption for small connecting words.
- Approve the curated lists after Phase 1 produces them.
- Approve a one-line pointer to this folder in `CLAUDE.md` (an `AGENTS.md` pointer is added now).
- Adviser review of any marked wording (declarations, protection and investor routes).

## 8. Known problems and gotchas

- Not verified: whether bidesh365 runs or what its database holds; what VisaStack's stored country rule packs already name; whether fact-level sharing to organisations exists beyond the recipient field views in `sharing.ts`; how the AI evaluation harness behaves when allowed keys grow; legal wording of declarations.
- Registered field definitions are first-writer-wins. Changing a label or protection level in code does not change an already registered definition. Phase 2 must decide the up-front registration approach.
- Production runs in controlled pilot: made-up data only. No production migration without the owner's explicit go for that run.

## 9. Conflict-avoidance protocol (Claude and Codex)

1. Before editing, read this file's status table and the last session log entry.
2. Claimed areas below are owned by whoever is listed until they mark it released. Do not edit a claimed file; add a note under "Requests" instead.
3. Work on your own branch. Never push to another session's branch.
4. After finishing, append a session log entry: date, who, what changed, files, how verified, what is left.
5. If the catalogue and legacy registry disagree, the checked-in guard tests say which wins. Do not edit a guard to make code pass without recording why here.

### Claimed areas

| Area | Owner | State |
|---|---|---|
| `packages/core/src/catalogue/**` | Claude | Planned (Phase 1) |
| `apps/web/src/lib/profile-fields.ts` | Nobody | Frozen until Phase 2. Do not change keys, packs, sensitivity or types |
| `packages/services/src/{sharing,classification,packs,ai}.ts` | Nobody | Phase 2. Ask first |
| `docs/product/master-profile-enrichment/**` | Everyone | Append only |

### Requests

(none yet)

## 10. Session log

### 2026-10-14, Claude: investigation and plan

- Read the profile, documents, sharing, classification, packs, rule conditions, expiry, reminders, assurance, wallet, contributor requests, AI and mission readiness code, plus the schema tables for fields, facts, versions, evidence links, conflicts, expiry policies and pack requirements.
- Wrote the three documents in this folder and a root `AGENTS.md`.
- Nothing in source, schema or stored data changed.
- Left: Phase 1.
