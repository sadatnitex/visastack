# ADR 0026: UMPE interface freeze v1 (shared contracts for parallel lanes)

- Status: Accepted (lead), 2 November 2026. Base: `origin/main` `d17d717c`.
- Context: the owner's UMPE programme (`docs/umpe/`, locked product contract plus implementation kit) runs several implementation lanes in parallel. The kit's `operations/INTERFACE_FREEZE.md` is a draft; this ADR is the verified, binding version for the decisions lanes need now. Everything not listed here is unfrozen and must not be assumed.
- Evidence: read-only discovery of the real code at `d17d717c` (packs, rules, import, agency and guest, source monitoring), baseline tests (8 files, 212 tests, green), and the new golden test `packages/services/src/umpe-no-loss-golden.test.ts`.

## Decisions

### D1. Published pack manifests are frozen at format 1
`buildManifest` (packages/services/src/packs.ts) emits exactly five keys per requirement (`kind, fieldKey, docType, citation, optional`), sorts items by `JSON.stringify(a).localeCompare(JSON.stringify(b))` and hashes `JSON.stringify({requirements})` with sha256. `verifyPackChecksum` recomputes from the current rows, so any new key emitted for an old row breaks every historic version. This output is now pinned by a golden checksum (`daf22ce5...5045`) and a proof that adding one key turns the guard red.

Two facts found and pinned:
1. The format 1 sort uses `localeCompare` (ICU collation, for example `Employer_Letter` sorts between `bank_statement` and `hotel_booking`). It stays as is for format 1. Collation is not a total order (NFC and NFD spellings, zero-width characters compare equal), which left such rows in database order and could make an untouched version fail verification after any row update. A UTF-16 tie-break now orders only pairs the collation calls equal, so every manifest without such a tie keeps its exact bytes and checksum (proven by the golden test, and the tie case proven red on the old sort).
2. Postgres `jsonb` reorders the keys of the stored `manifest`, so the stored manifest is equal in content but not byte-identical to the checksummed text. A verifier must never hash the stored jsonb; it recomputes from rows or canonicalises first.

### D2. New rule semantics use a versioned serializer, never a changed one
- `pack_versions.manifest_format` (nullable integer, NULL means 1) will be added in the P1 schema slot.
- `buildManifest(rows, format = 1)`: format 1 is byte-identical forever. Format 2 adds `formatVersion: 2`, sorts by UTF-16 code unit order (JavaScript's default string comparison `a < b`, locale independent; any verifier in another language must compare UTF-16 code units, not code points), and appends new keys after the legacy five only when they are non-null.
- `approvePackVersion` chooses format 2 only when a row uses a new field; `verifyPackChecksum` and the admin manifest download pass the version's own format.
- Existing approved or published versions are never rewritten.

### D3. Necessity is separate from evaluation state and from sharing categories
- Authoring necessity (new nullable `pack_requirements.necessity`): `MANDATORY`, `CONDITIONAL`, `RECOMMENDED`, `OPTIONAL`. Provenance is a separate nullable column `pack_requirements.provenance`: `OFFICIAL`, `AGENCY_ADDED`, `AUTHORITY_REQUESTED` (NULL means OFFICIAL for authoritative packs). Alternatives are a grouping, not a necessity. These names supersede the draft names in `docs/umpe/operations/INTERFACE_FREEZE.md` and `docs/umpe/discovery/P1-packs.md` (`ALTERNATIVE_GROUP`, `ADDITIONAL_REQUEST`). NULL necessity means legacy and is derived from `optional`: `false` maps to `MANDATORY`, `true` to legacy non-blocking (shown as Optional; the old boolean never distinguished recommended from optional, and we do not invent that meaning).
- Alternatives: nullable `group_key` plus `group_mode` (`ANY_OF` only in v1). One satisfied member satisfies the group; the group counts once; members are never double counted.
- Evaluation state stays the existing `RequirementResultState` vocabulary. `NOT_APPLICABLE` only when a condition evaluates to false; a missing fact gives `UNVERIFIED` (pinned by the golden test). For format 2 rows an invalid stored condition gives `UNVERIFIED` (fail closed). Format 1 rows keep today's behaviour (an invalid stored condition is treated as unconditional, which demands the item rather than hiding it).
- `RECOMMENDED` and `OPTIONAL` never produce a blocking gap. An `AGENCY_ADDED` item never presents as an official requirement; whether it blocks the agency's own request is the agency's choice, shown as the agency's. An `AUTHORITY_REQUESTED` item may block, with its source shown.
- `PROFILE_PACKS` / `SHARING_CATEGORIES` (packages/core) remain the only sharing-scope vocabulary and are never used for requirements, and vice versa.

### D4. Agency collection requests exist before any person record
- New tables (P6 slot) hold `organization_id`, the issuing account, route intent, an append-only revision table anchored to `pack_version_id` plus pack checksum and a separately labelled agency overlay, and a link table storing only a token hash (reusing `generateInvitationToken` / `hashInvitationToken`), with expiry, revocation and reissue history.
- These tables carry no `applicant_id`, `mission_id`, `owner_account_id`, `document_id` or `document_version_id` column, because no person record exists yet. That is not an exemption from access control: the lane that adds them must extend the access ratchet with a collection-table set and an organization- or request-scoped gate type (the way ADR 0025 did for person billing tables), so every exported function that reads them must take that proof. The same applies to guest tables (D5).
- The public link is never identity: it opens a separate `/collect` route that shows only neutral agency branding (verified, ACTIVE agencies only), never a person, route, checklist or account existence, with the same answer for unknown, expired and revoked links.
- The existing email-bound client invitation (`client-invitations.ts`) is not modified.

### D5. Guest collection never creates an account or applicant
Guest sessions and uploads (P8/P9) are request-scoped. No `accounts` or `applicants` row is created. The recipient-proof method (email one-time code through the existing mail outbox, without a sign-in account) needs the owner's decision before any guest upload is accepted; until then no guest file route exists.

### D6. Source observations are never verified rules
Lane E adds `official_sources`, `source_check_runs`, `source_observations` and `source_change_candidates` (slot 0115). The weekly job (`0 3 * * 6` UTC, Saturday 09:00 Asia/Dhaka, idempotent per Dhaka week) only records fetch outcomes and candidate changes. It never creates, approves, publishes or edits a pack. "Last fetched" and "last verified by a person" are separate fields. Blocked or failed fetches are exceptions, never "checked" and never "requirement removed".

### D7. Import stays on the existing transport until a staging slot is granted
P2 is a client-side bounded queue over the existing per-file upload route. An `UPLOAD_UNKNOWN_OUTCOME` is never auto-retried (no hidden duplicates); only definitive transient refusals (429, 503) are retried. Unassigned staging, person attribution and a server idempotency key need a later schema slot (P3).

### D8. Process rules for the programme
- One schema writer at a time. Migration numbers are allocated by the lead when a lane is granted its slot, never reserved in advance: 0115 is Lane E.
- No new product-event or notification event types except in the integrator's PR that also updates their tests.
- Lanes develop in separate local worktrees. Only the session's designated branch may be pushed, so lanes land as sequential PRs from that branch unless the owner allows `umpe/*` branches. Local worktrees vanish with the container, so the lead integrates each lane into the designated branch and pushes as soon as the lane hands back, and records any unpushed lane in `docs/umpe/operations/STATUS.md`.
- `docs/umpe/operations/verify-locked-sources.mjs` runs in CI (`scripts/umpe-locked-sources.test.mjs`); an edit to a locked source or its working view fails the build.

## Consequences
Lanes A (import) and E (source monitoring) can build now. Lane B (P1 necessity and alternatives) takes the next schema slot after Lane E lands. Lanes C and D start after P1, with D gated on the owner's guest-proof decision. Contract changes are made by superseding this ADR, never by editing a frozen format.

## Addendum, 2 November 2026 (owner decisions and P1 facts)
- D5 guest proof (owner): a six-digit one-time code sent by email to the address the agency entered for that request; no account is created. A request without an email hint has no guest path (the guest is told to ask the agency).
- D5 guest retention (owner): at submission the guest chooses how long the agency may keep their files after the request closes: 3, 7, 15, 30, 60, 90 or 180 days, with no preselected value; legal holds override.
- D3 in code: `packages/core/src/requirement-necessity.ts` is the single definition; migration 0116 adds the nullable columns. Format 2 manifests sort by UTF-16 code units and append new keys only when non-null.
- D3 consequence recorded: cases carry no route yet, so a pack that names a route is listed but never auto-linked to a case (no published public pack had a route in production on 2 November).

## Addendum 2, 2 November 2026 (lead decision under the owner's pre-approval)
- P7 sharing path: the existing grant model scopes whole documents and serves the latest version, so it cannot give an agency only the exact versions a traveller approved. Chosen: a response-scoped read path. The agency reads only through an immutable response record (request revision, applicant, exact document and fact version ids, consent wording version) that serves exactly those versions through a version-exact helper extracted from accessDocument; no grant is created, newer uploads never become visible, and access ends on withdrawal, erasure, request revocation or agency closure. The same generic collection-response queue serves guest submissions (P9). Rejected: a version-pinned grant (rewrites policy for every grant consumer), frozen copies (duplicate personal data), a document grant (later versions leak).
- Merge order from here: P3, P8, P7, P9; P4 after P3.

## Addendum 3, 3 November 2026 (lead decisions under the owner's pre-approval)
- Published-rule impact on agency requests: an issued agency checklist is never rewritten. When a newer official version is published, the agency sees it on the request page (through its own organization scope) and may issue a new revision; agency requests are not added to the traveller rule-impact notes, because the collection tables accept only agency or link proofs.
- One note per publication: once the rule impact tables (migration 0123) exist, the P4 package sweep leaves newer publications to the P11 rule impact notes; before that migration the P4 sweep still reports them.
- Daily jobs: the package change sweep (P4) and the rule impact sweep (P11) run inside the existing daily process-notification-sweeps job; the job route alone creates the system scope (access ratchet rule).

## Addendum 4, 3 November 2026 (P9 guest uploads, lead decisions under the owner's pre-approval)
- A copied agency link inherits the address the agency entered on the request, for the guest path only and at read time. The signed-in account path keeps P7's rule that a copied link binds to nobody.
- Guest submissions reuse the existing response-submitted event with an extended send-time check; no new event type in P9. The guest email on Needs Correction is added by gap package G3 with its own event and send-time check.
- The guest session idle window stays 30 minutes; a signed-in visitor on the desk has its own 2-hour clock. The desk cookie stays scoped to /collect.
- Guest purge (chosen period after the request closes, legal holds excluded) and expired session and code purge run inside the existing daily erasure job; the job route alone creates the system scope.

## Addendum 5, 3 November 2026 (combined integration of P13, G3 and P12, lead decisions under the owner's pre-approval)
- P13, G3 and P12 merge as one pull request (one full check and one CI cycle instead of three); records stay per unit. Migrations in merge order: 0125 agency member capabilities (G3), 0126 outcome attempts (P12).
- Navigation reads request authority live: a member (not owner or admin) gets Document Requests only while the switch is on and only if they hold May Request Documents; a failed read hides the link; the pages check again.
- Field Insights reuses the existing FEEDBACK_VIEW platform permission (no new grant) and appears under platform tools only for holders.
- Recording an outcome attempt asks for no fresh sign-in: the records are the traveller's own, append-only, and carry no files; this keeps friction low with the same protection.

## Addendum 6, 3 November 2026 (G1 joins the combined integration)
- G1 (intake follow-through) joins the same pull request; its migration becomes 0127.
- Background kind suggestion respects the existing protected-kind rule: a file whose kind is unknown is treated as protected, so the classifier does not run on it until the platform owner takes unknown kinds off the protected list. That is the owner's decision; nothing changes it automatically.
- Held family files (Which Person?) whose owner account is deleted are removed by the daily held-file sweep once the owner link is cleared; account deletion does not yet queue their erasure itself (recorded gap).

## Addendum 7, 3 November 2026 (G2 and G4, owner decisions of 3 November)
- Owner decision: every file is recognised by AI and placed. Lead design (G4): rules first; then a recognition-only step on a redacted, bounded excerpt (ADR 0022 redaction) that returns only kind, owner hints and period, under the same consent, kill switch, provider, budget and rate gates as every AI call. High-confidence results are applied with a one-step Change; low confidence stays a proposal. Detailed reading runs only for kinds that are not protected, re-checked on every pass (fixes the same-pass defect where a suggested kind was read before its protection was checked). The admin unknown-types switch now governs detailed reading only and stays on.
- Family filing: an exact unique match (full name and date of birth to one person the uploader may act for) files automatically with Change; anything else waits for Which Person?. Home shows waiting files; a reminder after 7 days; removal at 30 days; account deletion queues erasure of held files at once.
- Owner decision: AGENCY_COLLECTION_REQUESTS switched on in production on 3 November 2026 (Vercel production variable, redeploy dpl_Eg5fPfEFwLXDVV7RQnYCDTfByk8H).
- Rule details and route conditions (G2) belong to the pack version: editable only on drafts, copied forward to new drafts, part of the manifest checksum only when present, so publication, dual approval, version diffs and P11 rule impact all apply. A field observation is its own provenance everywhere, never official.

## Addendum 8, 4 November 2026 (Lane D, exact copies of evidence request answers; AWAITING OWNER CONFIRMATION)
- Decision D1 (proposed by the Product Excellence programme, not yet confirmed by the owner): when a traveller sends a file in answer to an agency evidence request, the send is consent for exactly that version of that file to reach exactly that organisation, for as long as the organisation's MANAGE standing lives (an active organisation holding a current MANAGE grant that covers the request). The agency may open that copy only as an original download, with a recent identity confirmation bound to that version; there is no preview for the agency (decision 6 of ADR 0022 stands). The consent ends with the standing: a revoked, paused or expired grant, or a suspended organisation, stops every later download and every later send, while the record of what was sent and decided stays until the document, the request or the traveller is deleted (the rows go with them, by cascade). Erasing one version does not remove the send: the version row and its stored object survive while the document exists, so the send row stays and is only refused as unusable (it cannot be accepted or opened). The rows, and then the "Sent before exact versions were kept" label on a decision, appear only when the whole document, the request or the traveller is deleted; a decision is never shown as a pinned copy once its send is gone.
- Departure from policy rule 1 ("every action is granted exactly"): this path serves the ORIGINAL download on the organisation's MANAGE standing plus the traveller's send, even when the grant does not list Download Originals. That is the substance of decision D1. It is recorded here as decided under the owner's blanket authorisation of 4 November 2026, but it is AWAITING a specific owner reading of this exact point; until then it is not to be described as owner-approved. The identity confirmation for the version is still required, and no other action (preview, other versions, other documents) is widened.
- Why it needs the owner: it is a statement about what a traveller agrees to by pressing Send, and it keeps the agency's access to the file alive after the decision (an accepted copy stays openable while the standing lives). The code is built so that turning it down is a small change (stop serving accepted copies, or serve nothing), but nothing is released as "exact version custody" until the owner confirms this wording and the two-account browser proof exists.
- Pinning: migration 0132 adds two tables and changes no existing one. `evidence_request_submissions` holds one row per send (round number, the exact document version, its stored object, checksum when one was recorded, size, the kind and name at send time, who sent it, when, the grant it was made under, a retry key). `evidence_request_decision_submissions` links each decision to the one send it judged, once per send. A database trigger refuses any UPDATE of either table; a correction is a new row.
- Rules that follow: a send and a decision each lock the request row and re-check who is acting; a reviewer who looked at a replaced copy is told to look again; accepting needs the pinned copy to be usable, the same stored object and checksum, and the same kind as when sent; sending back is always allowed. Only the copy waiting for a decision, or the accepted one, serves bytes. Nothing falls back to the document's latest version.
- Before the migration runs: the older flow keeps working with the same hardening, no exact copy is kept, no file can be opened, and the list reports exact copies as not available, labelling anything sent earlier "Sent before exact versions were kept". Nothing is backfilled; an old send is never described as pinned.
- Serving: the link carries a new actor kind (`evidence_submission`) whose purpose names the send; the serving route's re-check replays the live send, the agency admin, the organisation's standing and the pinned object, within the existing 60 second limit.
- Releasing it: drain older application instances before the migration runs (an older instance beside the new one writes sends and decisions without exact copies; the code treats such rows as older, never as pinned, and refuses to serve a send that a later unlinked decision already closed).

## Addendum 9, 6 November 2026 (decision D1 confirmed by the owner)
- The owner read decision D1 (addendum 8) and approved it as written, through the decision pack of 6 November 2026 (item 1). A traveller's send is consent for exactly that copy to reach exactly that organisation while the organisation's MANAGE standing lives, even when the grant does not list Download Originals. The line the traveller sees is unchanged: "Sending lets the agency download this exact copy while it has access to your records. Later changes to the file are not sent." Addendum 8 is no longer awaiting confirmation.
