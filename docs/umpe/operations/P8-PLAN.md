# P8 plan: guest proof and branded Document Collection Desk (Lane D)

Base: origin/main 5aea5d6 (P6 merged as #414). Switch: AGENCY_COLLECTION_REQUESTS, off in production.

## Data (TEMP migration, last commit)
- agency_collection_guest_sessions: SHA-256 of a random session id, bound to link, request and revision; verified_at, last_seen_at (30 min idle), expires_at (12 h maximum), revoked_at. Rotated in place on verification (new id, same row).
- agency_collection_guest_codes: SHA-256 of the six-digit code (salted with the code row and session), bound to one session and link; 10 minute expiry, attempts capped at 5, consumed_at (used or replaced).
- agency_collection_guest_drafts: one pending submission draft per link (so a resume on another device finds it); retention_days in 3, 7, 15, 30, 60, 90, 180, null until chosen. P9 adds files.
- No accounts, applicants, cases or grants are ever written.

## Gates (access/guest-collection.ts, ratchet extended, no exemptions)
- GuestCollectionSessionProof: possession of a session cookie value (hash only). Minted only by guestCollectionSessionProof(), allowed only in apps/web/src/app/collect.
- GuestCodeDeliveryProof: possession of the sealed code at send time. Minted only in notifications.ts.
- Both private-constructor classes with #brand; every service calls isGenuine first and re-validates the session live (link open by P6 rules, request SENT, agency open, issuer still owner or admin).

## Services (packages/services/src/umpe-guest-*.ts)
- startGuestSession(link proof): new unverified session for an open link, raw id returned once.
- readGuestDesk(session proof): neutral null, landing (agency brand if ACTIVE, guest available only with an email hint, code pending), or verified (exact issued checklist from the session's revision, retention choice).
- sendGuestCode / verifyGuestCode / saveGuestRetention / endGuestSession; audits with counts and kinds only.
- guestCodeStillDeliverable(delivery proof): the worker's send-time recheck.
- Rate limits: code send per link and per IP, verify per link and per IP.

## Email
- New event AGENCY_COLLECTION_GUEST_CODE in invitation-email.ts (sealed code, never plaintext in the outbox), notifications.ts send-time recheck, email-design.ts copy plus an optional code block. Neutral words: no person, route or documents.

## Web (apps/web/src/app/collect/**, not account/**)
- /collect/open: link token becomes a server-side session; the cookie holds only the session id.
- /collect: branded desk (logo through a session-gated /collect/logo), Sign In to Respond -> /collect/account, Continue Without an Account; code form; verified checklist (necessity labels, Any One of These groups, agency items labelled) and the reusable RetentionChoice component. Server actions in collect/actions.ts.
- Forms registered in a11y-forms.test.tsx; CSS block WP-UMPE-P8 appended to globals.css.

## Tests
No accounts or applicants rows; wrong, expired, replayed codes refused; attempt cap; another link's session cannot read this request; forwarded link alone shows the neutral desk; revoked link ends the session; code email suppressed at send time after revoke; cookie never holds the link token; switch off returns not found. Prove two guards red.

## P7 contract
P7 reads the desk session through load.ts readCollectSession() (link id, verified flag); the old <linkId>.<token> cookie is gone.
