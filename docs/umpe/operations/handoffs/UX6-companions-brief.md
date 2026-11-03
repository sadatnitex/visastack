# UX6 step 2 brief: travelling with someone else (companions and invitations)

Status: decided by the owner on 3 Nov 2026 (see Owner decisions); package 1 is being built. The migration word is still needed before any run: the number is expected to be 0130 (the next free number when this was written; confirm it again before any run, per ADR 0026 D8).

## The idea in one line

A trip can include people who are not the organiser's own managed people: a friend or colleague, with or without a VisaStack account, added by name and an optional email. They see only the trip basics and only join by accepting. Nothing of theirs is shared with the organiser beyond what they choose.

## Two kinds of traveller (as agreed)

| Kind | Who | How they join | What is stored and shown |
|---|---|---|---|
| My people | Me, family, children in my care | Pick from the list or Add a Family Member (built in step 1) | Their own record and case on my account |
| Someone else | A friend, colleague, anyone | Name, plus an email if I have one. They get an invitation | A name. They see the trip basics. They join only on accept |

## Design (grounded in the code as it stands)

1. One new table, `umpe_trip_companions` (additive migration, `CREATE TABLE IF NOT EXISTS`, like 0122): id, trip_id (FK umpe_trips), display_name (1 to 120, as the organiser typed it), email (lower-cased, optional), state (NAME_ONLY, INVITED, JOINED, DECLINED, REMOVED), token_hash (unique, only the hash), expires_at, joined_account_id (set on accept), invited_by_account_id, created_at, updated_at. No applicant_id and no shadow applicant: the master spec forbids a shadow applicant or a second authorisation engine, and ADR 0026 D5 says no accounts or applicants row is made for someone who has not joined.
2. Readers and writers tolerate the table being missing, with a presence probe like `tripTablesPresent` (never raises, caches only a positive result). A switch `UMPE_TRIP_COMPANIONS_ENABLED` (off unless the word "true", as `umpe-collection-request-switch.ts`) hides the section and makes the accept page a 404 when off.
3. Invitation, mirroring `sharing-invitations`: token from `generateInvitationToken`, only `hashInvitationToken` stored, 7 day expiry, single use claimed with `UPDATE ... WHERE state='INVITED' AND expires_at > now`. The email is queued through `queueInvitationEmail` with a new `companion` kind (entries in the subject, summary, link path and reveal pattern lists, plus `NOTIFICATION_EMAIL_COPY`), sealed so the outbox never holds a usable link, and re-checked at send time. No lookup of whether an account exists anywhere in the invite path.
4. Accept is a confirmed POST (link scanners must not consume it). The person signs in or signs up with the invited email; a missing, expired, used or wrong-email link all show the same "Invitation Unavailable" page with no detail. The accept screen says plainly: joining shows your name to others on this trip, and nobody gets access to anyone's documents.
5. Access, the part that needs the most care: a new proof class `TripCompanionAccess` (private constructor, minted per read from a live JOINED row bound to the signed-in account, re-checked each read, as `CollectionResponseAccess` does) added to `GATE_TYPES` in `access/enforcement.test.ts`. Its one read returns only title, destination, purpose and the names of people who chose to appear. It never returns itinerary reference, applicant or case ids, case state, relationships, evidence or documents. A removed, declined, expired or unknown companion looks the same as a missing trip. `requireAccess` is not used: a companion has no applicant.
6. Names: a companion appears under the name the organiser typed until they accept; on accept they confirm or change the name shown. The organiser's own managed family members are never listed to a companion by name (they may include minors): the companion sees only "N more travelling with the organiser". This is a decision for the owner (below).
7. Abuse and enumeration: new rate limits (invitations per organiser per hour, per hashed email, a per-trip cap such as 20 companions); the organiser never sees delivery status, bounces or "already accepted by an existing account", so nothing differs by whether an email has an account. Resend is limited and replaces the old link. The organiser can remove anyone at any time; a companion can leave at any time; both end access on the next read.
8. Audit: events with ids, counts and kinds only (invited, accepted, declined, removed, left). New event types need the integrator PR that also updates their tests (ADR 0026 D8).
9. Not in scope here, and a real design decision: a joined companion does not become a traveller on the organiser's trip. Trips are owned by one account and their travellers are that account's applicants. Making someone else's own case part of the same trip needs cross-account membership and per-person consent, a larger change. Recommended for now: on accept the companion can "Plan My Own Case for This Trip", which starts their own case with the same destination and purpose on their own account, with no link back that gives the organiser anything. That keeps "nothing of theirs is shared with me beyond what they choose".

## Where it shows

- Organiser: in Start a Group Trip and Add Travellers, next to Add a Family Member, one more choice "Add Someone Else" (name, optional email). The trip page lists them under "Travelling with You": Invited, Joined, or "Not on VisaStack yet" for a name with no email, with Remove.
- Companion: an invited list under My Trips and the accept page; a read-only trip page with the basics.

## Delivery in four small packages

1. Migration, service, `TripCompanionAccess`, ratchet entry, rate limits, tests (needs the migrate word).
2. Organiser forms and the trip page list.
3. Email kind, accept page, switch.
4. Companion read-only page and "Plan My Own Case for This Trip".

## Owner decisions (given 3 Nov 2026, in force)

1. Never list the organiser's managed family members by name to companions (a companion sees only "N more travelling with the organiser").
2. Companions are adults only; a child is added as a family member instead.
3. At most 20 companions per trip; an invitation lives 7 days.
4. Joining leads to "Plan My Own Case for This Trip" (their own case on their own account); cross-account trip membership waits.
5. The companion decides how much of their own information the organiser sees, because they travel together (below).
6. Still needed: the word "migrate NNNN" for the migration number, only when a package that carries a migration is merged and ready to run.

## What a companion shares with the organiser (their choice, never the organiser's)

A companion chooses a sharing level on the accept screen and can change or withdraw it at any time; it takes effect on the next read. The default is the smallest.

| Level | The organiser sees | Notes |
|---|---|---|
| Name Only (default) | The name the companion confirmed, and Joined | Nothing about their case |
| Plan Status | Also one plain phrase for the companion's own case for this trip (for example "Getting Ready", "Ready to Share") | A phrase only: no checklist, no documents, no personal values |
| Travel Bookings | Also the names of booking, itinerary, invitation and accommodation papers the companion chose to add to the trip | Same common-evidence rule as family trips: passports, bank and medical papers are never shareable; each paper is an explicit choice and can be withdrawn |

- The level is stored on the companion's row and set only by the signed-in companion; the organiser's own account can never set or raise it.
- The organiser's read returns only what the level allows and re-checks the live row each time. Lowering or withdrawing a level removes it from the next read.
- Package 1 stores the level (all three values) and enforces Name Only and Plan Status; Travel Bookings is built in package 4 together with the companion's own trip page.
- Every change of level is audited (ids and the level only).

## Security review checklist (before any merge)

- A companion can never read another person's profile, document, case or the organiser's other trips.
- Unknown, expired, used, wrong-email and removed all look identical.
- The organiser cannot tell whether an email has an account (response text, timing, delivery status, resend behaviour).
- Tokens: only the hash stored, single use, a confirmed POST, never in a log or an audit row.
- Rate limits and caps in place; the enforcement ratchet passes with the new gate type.
- The notification worker re-checks the invitation at send time.
