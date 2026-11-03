# G4 plan: every file recognised, placed, and read only when safe

Owner decision (3 Nov 2026): AI knows every file, recognises it, categorises it and places it. Unknown kinds stay protected for detailed reading.

## Recognition (separate from reading)
- New `umpe-document-recognition.ts`: `buildRecognitionExcerpt(text)` keeps the first lines (max 60 lines, 1,500 characters) after removing machine-readable passport lines, IBANs, labelled account and card numbers, emails, and every run of 4 or more digits that is not a date or a plain year (reuses the ADR 0022 matchers exported from redaction.ts: `hasIban`, `looksLikeAccountNumber`, `looksLikeDate`).
- The background suggestion (`suggestDocumentKindInBackground`) sends only that excerpt and stores only kind and confidence (no rationale). Name match and period are worked out on our side from the full text and never asked of the AI.
- Same gates as today: ai_document_kind switch, CORE_PROCESSING and AI_EXTRACTION consent, kill switch and provider terms (`isAiDispatchAllowed`), budgets, cache, attempt caps, rate limit. Recognition no longer waits for the Automatic Reading feature, because it is not reading.

## Automatic placement
- Confidence at or above 90: kind applied, automatic title replaced by the suggested name (a name the person chose is never touched), proposal approved by the system, one `document_auto_placements` row (previous and applied kind and name), audit `DOCUMENT_RECOGNISED_AUTOMATICALLY`. Below 90: proposal waits in Needs One Decision as today. No placements table yet (before migration): never placed automatically.
- Change (owner proof, MANAGE): restores the previous kind and name only if nothing changed since, puts the proposal back to waiting, removes the system classification row, audited. Recognised once per document: a changed placement is never reapplied.

## Reading stays protected (defect fix)
- `processAiReading` order: kill switch, recognition when kind is unknown and text exists, then the feature and consent checks, then protection re-checked against the applied kind, or for an unknown kind against the switch and any waiting suggestion. Re-checked again after AI OCR plus recognition, before extraction. No AI OCR for an unknown kind while unknown kinds are protected.
- Accepting or changing a kind queues a fresh reading job (reset of the existing job row), which re-checks protection.

## Family files
- Hold route: an exact unique match (existing `proposePerson`) plus `requireAccess` MANAGE for that person files it at once (`fileHeldFile`, automatic flag); placement row PERSON. Change (only while untouched: one version, no approved details, no case use, no share, no legal hold, no safe copy boxes) returns it to Which Person?: hold back to HELD with the same bytes, document row deleted (cascade).
- `countHeldFiles` for Home and the traveller Home ("N Files Need a Person", one line each, P13 pages).
- 7-day reminder: one in-app and email note per hold queued by the daily held-file sweep; send-time recheck that the hold still waits.
- Account deletion: held (unfiled) files queued for verified erasure and their rows removed in the same transaction (`queueHeldFileErasure`, one call in deletion.ts). Sweep stays.

## Admin
- Document Protection page: plain words that unknown files are always recognised safely; the switch only controls detailed reading of unknown kinds.

## Tests
Listed in the brief; plus guard-red proofs for the same-pass defect and the excerpt.
