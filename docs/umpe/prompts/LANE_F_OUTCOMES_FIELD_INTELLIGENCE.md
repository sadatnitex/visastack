# Lane F: outcome provenance and field intelligence (P12)

Start analysis early, but do not build final tables/reports until P4 package/attempt and P9 guest receipts have stable references. Read L3 §5, L4 §9 and audit `O01-O07`. Inspect `missionSubmissions`, `missionOutcomes`, `application-memory.ts`, `product-events.ts`, snapshots and guest receipt semantics. Existing fields are not proof of actual authority submission.

## Deliverables

- Explicit source-provenance funnel: request/created -> prepared -> handed to agency -> agency accepted/requested correction -> applicant **reported** external submission -> independently evidenced authority receipt when available -> authority extra request, decision pending/unknown/approved/refused/withdrawn/cancelled. Do not treat agency review as consular decision or a finished pack as filed application.
- Multiple external submissions/decisions must be **distinct attempts**, including which immutable pack, evidence, route, purpose, jurisdiction, dates and applicant attributes were known at each attempt. Self-reported outcomes remain labelled self-reported even if from a confirmed account. Guest agency records are limited by lawful data-rights rules and not made publicly visible.
- New *authority* request event is distinct from agency internal request/correction; do not backfill ambiguous legacy fields with invented proof.
- Start with a restricted internal data-quality dashboard: invitation/request funnel, missing outcome denominator, sample counts by route/source period, frequency of additional documents, correction causes and incomplete checklist coverage. Apply minimum cell-size and dominance suppression, no PII in analytics events, no raw medical/financial/sensitive information in general-purpose aggregated logs; default deny unauthorised access.
- All reported patterns framed 'Observed in VisaStack cases', not 'official requirement'. No personalized approval probability, causal claims, agent steering or 'this document raises chances' advice. Published official rules only change via P10/P11 verified source process.

## Tests

Two submissions on same case have different decisions and evidence with correct attempt association. Unreported external status remains UNKNOWN; guest agency receipt does not equal authority submission. Recorded refusal/approval with no official decision evidence is not called independently verified. Small cohorts are suppressed; disjoint agency access cannot reconstruct another org's PII. Removal/retention removes source data from future reporting per policy; no accidental resurrection.

## Handoff

Create P12 in one compact PR after upstream references; use approved schema slot; no broad changes to product-event closed vocabulary without lease. Record evidence and limitations instead of a flashy unsupported success-rate graphic.
