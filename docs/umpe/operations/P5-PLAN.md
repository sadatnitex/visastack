# P5 plan: group trips and family packages (branch umpe/p5-group-trip, base d6cecf3f)

## Audit (what exists and is reused)
- missions.itineraryRef: a free-text label, display only, read by listMissionsByItineraryRef for the account's own travellers. Kept: a trip writes its label into a traveller's case only when that case has none.
- Managed profiles: applicants owned by one account; FAMILY_MEMBER and MINOR_GUARDIAN carry authorityConfirmedAt (never inferred). Records made before that column have no confirmation.
- P4 start (openOrStartTripCase) opens the traveller's active case for the same destination and purpose or starts one; getCasePackage gives the phrase and reasons per case.
- Sharing: grants and sharing invitations let another account's owner share their own traveller with you. An outside adult stays theirs: never added, never edited.

## Built here
1. Tables: umpe_trips (owner account, destination, purpose, title, itinerary label); umpe_trip_travellers (trip, traveller, case; removed_at keeps history; one live row per trip and traveller); umpe_trip_evidence (a common document from one traveller, booking and itinerary types only); umpe_trip_evidence_allowances (one row per traveller the owner allowed, revocable).
2. Services umpe-trip-{tables,rules,service}.ts. Every export takes an owner proof (AuthorizedApplicant, actor applicant_owner); a trip is found only by id AND owner account, so a denied trip looks missing. Adding a traveller takes that traveller's own MANAGE proof, checks authority (family member and child records need a confirmed authority; a child needs a guardian record), then opens or starts their case through P4. Removing a traveller ends the link, revokes allowances to and from them and keeps their case untouched.
3. Common evidence: added from one traveller's document (proof on that document); visible to another traveller only through an explicit allowance made with that traveller's proof. Restricted types (passport, identity, finance, medical) are refused.
4. Overview: each traveller's readiness phrase (P4) and one next action (pure rule), with a link to their case. Nothing is shared between travellers automatically.
5. Pages: /app/trips (list), /app/trips/new (Who's Travelling?), /app/trips/[id] (overview, Add Travellers, remove, common evidence). Link only from P4's start page.

## Tests
Different nationality gives different checklists; a child needs a guardian record with confirmed authority; an outside adult is never edited; common evidence is invisible without an allowance; removing a traveller keeps the case; trips of another account look missing; tables missing gives a plain refusal and an empty list.
Guards to prove red: the authority check; the allowance filter.
