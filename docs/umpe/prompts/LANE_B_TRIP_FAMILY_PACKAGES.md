# Lane B: one intention to an exact application package (P4/P5)

Execute in independent worktree after P1 rules interfaces and P3 attribution/proposal API are stable. While waiting, write fixtures and inspect existing `createMission`, `computeReadiness`, `prepare-again`, `selectedEvidence`, `application-memory` and `itineraryRef`; no conflicting edits. Read L2 §C-E, L3 §1-2, audit IDs `R11-R23`, `R19-R22`, `S07`, plus permissions.

## P4 individual package

- User states destination, purpose, tentative dates; ask only missing route-critical context (nationality, residence, place of application, funding, sponsor, age/guardian etc.). Use **exact published official pack** only when coverage is verified for route/context/effective date; fallback to honest manual/agency checklist when unavailable.
- Produce only applicable mandatory/conditional/alternative/recommended requirements. Match current/eligible exact document and fact versions from owned vault with confidence/ambiguity explanations and ability to replace/add/exclude chosen item. An excluded mandatory requirement remains unresolved; a recommended missing item never blocks.
- Preserve separate `Needs attention`, `Ready for final review`, `Prepared for handoff` semantics and existing `overallState` values with compatible presentation mapping. No approval guarantee; show what external form/appointment/biometrics may still be needed when official pack specifies.
- Final handoff/agency share pins the **exact evidence versions and exact pack/request version**. New upload never retroactively changes accepted/shared snapshots or expands a grant. Copy/download/export must obey existing access. Preserve current `missions` IDs and historic cases.

## P5 shared trips and monitoring

- One shared intention links independent per-person missions/cases via existing itinerary relation or a minimal separately approved group relation. No second case source of truth. `Add Travellers` selects authorized profiles; independent nationality/residence, adult consent, guardian authority, conditional requirements. Share one hotel booking where each participant is authorized, not everyone's passport to everyone else.
- New passport, statement period, employment fact, resolved conflict, expiry or official new pack: recompute only active affected packages and explain material impact. Never silently mutate a previously accepted version or resend an agency grant. Deduplicate notification events and preserve agency/user feedback.

## Tests

- Unverified route never shows green. Wrong route/country/consular jurisdiction never linked.
- Mandatory and alternatives, unknown conditional and recommended all behave correctly.
- Family of 3 with child + differing nationality produces distinct packages and safely reused authorized shared hotel evidence.
- Old issued/submitted snapshot unaffected by new bank statement or new official pack; active new package flags relevant update.
- Owner withdraws consent/revokes sharing, new package cannot expose old authorized data; originals stay private.
- Legacy mission/case screens, prepare-again, then-and-now and manual field editing remain available.

## Ownership/hand-off

Own only new package/trip components and delegated exact `missions.ts`/matcher hotspots. Schema via single writer. Submit two bounded PRs P4 and P5, reviewed for cross-person scope and exact history. Record user steps, fixture outcomes, and data-version IDs in a concise report. Coordinate with guest lane for a **common evidence matcher**; don't implement two competing matchers.
