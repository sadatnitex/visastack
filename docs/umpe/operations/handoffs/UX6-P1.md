# UX6 package 1: travelling with someone else (database, service, access gate)

Scope: the migration, the service, the access proof and the tests. No web screens, no email sending, no accept page (packages 2 and 3), no "Plan My Own Case" and no Travel Bookings content (package 4). The migration has NOT been run anywhere and needs the owner's "migrate 0130" word after merge.

## What was built

| Area | What | Where |
|---|---|---|
| Migration | One new table `umpe_trip_companions`, additive, `CREATE TABLE IF NOT EXISTS`, re-runnable like 0122. Number 0130 (journal index 128). | `packages/db/migrations/0130_umpe_trip_companions.sql`, `meta/_journal.json`, `meta/0128_snapshot.json`, `packages/db/src/schema.ts` (`umpeTripCompanions`) |
| Probe and switch | `tripCompanionsTablePresent` (never throws, caches only "present"); `UMPE_TRIP_COMPANIONS_ENABLED` (on only for the word "true") | `umpe-trip-companion-tables.ts`, `umpe-trip-companions-switch.ts` |
| Access proof | `TripCompanionAccess`: private constructor, brand, minted per read, at most 5 minutes old, standing JOINED or INVITED, re-checked by `tripCompanionAccessProblem` | `access/trip-companion-access.ts` |
| Service | Organiser: `addCompanion`, `listCompanions`, `removeCompanion`, `resendInvitation`. Companion: `openCompanionInvitation`, `previewCompanionInvitation`, `acceptCompanionInvitation`, `declineCompanionInvitation`, `getCompanionTrip`, `listMyCompanionTrips`, `leaveTrip`, `setCompanionShareLevel` | `umpe-trip-companions.ts`, exported from the services index |
| Rate limits | `COMPANION_INVITE` (30 an hour per organiser), `COMPANION_INVITE_EMAIL_DAY` (5 a day per hashed address), `COMPANION_RESEND_TRIP` (10 an hour per trip), `COMPANION_ACCEPT_ACCOUNT` (30 an hour per signed-in account) | `rate-limit.ts` |
| Audit | `UMPE_TRIP_COMPANION_ADDED`, `_RESENT`, `_ACCEPTED`, `_DECLINED`, `_REMOVED`, `_LEFT`, `_SHARE_LEVEL_CHANGED` (ids, tripId, kinds and the level only). Audit event types are free text in this repo: there is no registry or enumerating test to update. | `umpe-trip-companions.ts` |
| Ratchet | `TripCompanionAccess` added to `GATE_TYPES`; a new describe block lists the six functions that may take it and checks each calls `tripCompanionAccessProblem` on it. Baseline untouched. | `access/enforcement.test.ts` |

## Table facts

State: NAME_ONLY, INVITED, JOINED, DECLINED, REMOVED, LEFT. Share level: NAME_ONLY (default), PLAN_STATUS, TRAVEL_BOOKINGS. Database checks: name 1 to 120; email lower case and 3 to 254; a token and a lapse time exist exactly while the row is INVITED; one JOINED row per trip and account; one live row per trip and email (INVITED, JOINED); hashes unique. Foreign keys: trip cascade, organiser account cascade, joined account set null, own case set null. No applicant or account row is ever made for a companion.

## Behaviour decisions where the brief was silent

- The organiser's name for a companion is "The organiser" (accounts have no display name; the person's profile name is not a source companions may read).
- A companion only ever sees: title, destination, purpose, "The organiser", the other joined companions by their confirmed names, and a count "moreTravelling" of the organiser's non-self people on the trip. Nothing else is returned (key set is tested).
- Declined invitations read to the organiser as still waiting until they would have lapsed, then as expired. Reason: showing "declined" would tell the organiser the address has an account. Resend to a declined row answers the same but sends nothing (`invitation` is null); adding the same address again is refused as "already added". The declined row keeps the address (to block that) until the organiser removes it.
- Removed and left rows have their address cleared. Removed rows also drop back to Name Only.
- Accepting and listing invitations needs the signed-in account's email to be verified (every Neon Auth account is). Without that, an unverified account holding a matching address and the link would be refused. This is stricter than sharing invitations.
- The accept screen flow is: `openCompanionInvitation` (counts the try, makes the proof) then `acceptCompanionInvitation(db, access, input)`. Accept and decline take the proof, not just the token, so the access ratchet judges them honestly (they write an audit row).
- `addCompanion` and `resendInvitation` return the raw token and the recipient address once in `invitation`. That object is for the server-side sender only (package 3) and must never reach a browser, a log or a database column.
- A joined companion whose account is later erased is no longer listed (the joined account id is set null).
- The Plan Status phrase is derived from the companion's own case state only when the row's `own_mission_id` belongs to an applicant owned by the very account that joined, so a wrong id can never show someone else's case. Phrases: Getting Ready, Ready to Share, Submitted, Case Closed.
- `ownerAccountOf` in `umpe-trip-service.ts` is now exported (one word changed); the organiser functions use it so the owner-proof rule is the same one.
- `umpe-trip.test.ts` now drops `umpe_trip_companions` first in its "tables missing" test (the new table depends on `umpe_trips`).

## Tests (packages/services/src/umpe-trip-companions.test.ts, packages/db/src/umpe-trip-companions-migration.test.ts)

30 service tests on a real migrated database and 4 migration tests: add by name and by email, the 20 cap, duplicate and own address, nothing visible to the organiser, identical answers and no account query by address, rate limits in the same words, single-use accept, the one refusal for nine failing cases, consent, no accounts or applicants created, exact key set and no managed family names, removed, left, declined and expired read as missing, copied proofs refused, organiser never sets or holds a level, level changes on the next read, Plan Status phrase and its ownership check, audit contents, missing table and switch off.

## Proven red (break the real code, watch the named test fail, restore)

| Guard broken | Test that went red |
|---|---|
| Joined account check in `joinedCompanionAccess` | removed/left/declined, audit, and "organiser can never set or raise a level" |
| Email match in `invitedCompanionAccess` | the one-refusal test (wrong email) |
| Organiser-account refusal (invited mint, and the list) | "organiser can never set or raise a level" (both) |
| Expiry condition (mint, claim and summary together) | expired cases in the one-refusal test and the removed/left test |
| Claim WHERE, in-transaction re-check and already-joined check together | "a second use fails exactly like an unknown link" (stale proof replay) |
| Cap `>=` to `>` | the 21st person test |
| Key allow-list (added `itineraryRef`) | exact key set test |
| Family names (added a managed name) | the same test |
| Run-time check removed from `leaveTrip` | the ratchet's gate describe |
| `TripCompanionAccess` taken out of `GATE_TYPES` | the main applicant ratchet (the functions touch `umpe_trips`) |

Note: single use has four layers (token cleared on accept, state check in the proof, state check in the claim, already-joined check). Removing one alone leaves tests green by design; the proof above removes the stale-proof layers together.

## Not verified

- No web, email or accept page exists; the notification worker send-time re-check and the `companion` email kind are package 3.
- Travel Bookings stores and reads back but returns nothing extra (package 4).
- The migration was run only on the test database (PGlite). It has not been run on Neon and needs "migrate 0130".
- No per-network-address limit on invitation links yet (the signed-in account is the key here); package 3 should add `INVITATION_PREVIEW_IP` in the web layer.
- Concurrent double-accept is protected by the claim WHERE and the unique index but there is no parallel-request test.

## Security notes for the second reader

- Token handling: `generateInvitationToken` then `hashInvitationToken`; only the hash is stored; the raw token is returned once; no audit row, log or error holds it.
- Rate limit subjects for addresses are SHA-256 of the lower-cased address with a fixed prefix (no secret): enough to avoid storing the address, but a low-entropy address could be guessed from a bucket by someone who can read the database.
- `listCompanions` reads the companion's mission state across accounts, by design and only for a joined companion who chose Plan Status or more; check `planPhrases`.
- The organiser gate for companions is the owner proof of one of their own travellers (as the rest of the trip service), not a trip-level proof.
