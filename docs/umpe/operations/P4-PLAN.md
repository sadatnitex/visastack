# P4 plan: trip package assembly (branch umpe/p4-trip-package, base 1330a750)

## What already exists and is reused (no second case or package engine)
- missions.ts: computeReadiness (units, necessity, any-of groups, UNVERIFIED for unknown conditions), selected_evidence (pins document and fact ids, not versions), getEvidenceCandidates, snapshotMission (immutable, checksummed, captures exact version ids), material revision plus acknowledgement invalidation, prepareCaseAgain.
- pack-matching / case-checklist-match: the one-pack auto-link used by the case start form.
- source monitoring (P10): official_sources, source_change_candidates; pack_requirements.source_inaccessible_at; pack_versions.withdrawn_at / superseded_at.

## Missing, built here
1. Case-local package choices (R11, R14, R16, R17): new append-only table `umpe_package_choices` (one live row per case and requirement): Use This Copy (pins document_version_id or fact_version_id), Exclude (only items that can never block, reason required), Leave Missing. Use This Copy also narrows the existing selected_evidence so readiness agrees, and bumps the material revision.
2. Immutable handoff (R15, R16): new table `umpe_package_handoffs`, written once by an explicit traveller confirmation; references an existing mission snapshot (snapshotMission) and freezes pack version id and checksum, manifest format, every selection with version ids, caveats, freshness flags, outside steps, material revision and time. A database trigger refuses UPDATE. Later uploads only create proposals.
3. Three phrases (R15), pure function over Readiness: Needs Attention / Ready for Final Review / Prepared for Handoff (only while the latest handoff matches the case's material revision). Submitted to Agency / Submitted to Authority stay the existing separate records; nothing claims approval.
4. Freshness check (S05) at final review and handoff: pack version still PUBLISHED and not withdrawn, requirement sources marked inaccessible, P10 change candidates NEW or IN_REVIEW for the pack's or requirement's source, evidence past its age rule or expiry. Plain caveats, never a silent block.
5. Continuous matching (R19): new table `umpe_package_changes`, one open item per case. evaluatePackageChanges compares live pins and the latest handoff with current versions (newer document version, changed fact version, expiry, pack superseded or withdrawn); runs on case open (owner proof) and in a bounded SystemScope sweep over active cases only. Never touches handoff rows, never shares. Notification event type deferred until the lead says P8 merged.
6. Outside VisaStack list (R23): standard external steps plus requirement notes that mention forms, originals, appointments, biometrics, fees or translations.
7. Intention-first start (R13): new route /app/mission/start: Where Are You Going? Why? Who's Travelling? One case per traveller; an existing active case with the same destination and purpose is opened instead of a duplicate. Questions for dates or other facts appear only when the linked pack's conditions need them.

## Files
- packages/db/src/schema.ts (shared, append three tables), migration last as TEMP commit.
- packages/services/src/umpe-package-{tables,phrases,freshness,service,changes,start}.ts plus tests; missions.ts: one new gated reader for the package inputs; index.ts block `// UMPE P4`.
- apps/web/src/app/app/mission/start/*, apps/web/src/app/app/mission/[id]/package-*.tsx|ts, page.tsx insert, globals.css block `/* WP-UMPE-P4 ... */`, a11y-forms.test.tsx registration.

## Tests
No rewrite of a handoff after a newer document; recommended missing never blocks Prepared for Handoff; unknown condition stays Needs Attention; freshness flags a withdrawn version; continuous matching touches only active cases; ratchet green; golden and mission tests unchanged. Guards proven red: handoff immutability, exclude of a blocking item.
