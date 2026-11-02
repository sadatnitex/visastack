# P7 plan (Lane C2, account response), branch umpe/p7-account-response

Base: origin/main 5aea5d63 (P6 merged as #414). Owner decision (2 Nov): sharing option B, a response-scoped read path; build it.

## Round 1 finding (kept for the record)
Grants scope to whole documents and the agency read path serves the latest version, so a grant would leak later versions. Options A to D are in handoffs/P7.md history; the owner chose B.

## Build (option B)
1. Schema (TEMP migration, last commit): `agency_collection_responses` (request, exact revision, link, person, submitter, destination and revision number snapshot, consent version, content SHA-256, submitted, withdrawn once) and `agency_collection_response_items` (one line per issued item: exact document version, exact fact version, or Still Missing). Append-only triggers; only a withdrawal may be recorded, and only a cascade (person, document, agency removed) may delete.
2. Gate `CollectionResponseAccess` (access/collection-response-access.ts): minted only from a fresh `AgencyCollectionScope` for one live response of that agency; registered in both access ratchets. Recipient email check (same semantics as client invitations, refusal audited once) lives there too.
3. documents.ts (one shared lease): one link-minting helper for every file path; `previewCollectionResponseVersion` serves exactly the listed version; `recheckDocumentAccess` replays a response link against the live response (never a grant).
4. Services (`umpe-collection-response-*`): open desk, propose (owner proof, matching current copies and confirmed details), submit (SHARE with step-up, choices re-checked against server proposals inside a per-person lock, earlier live answer withdrawn), own list, withdraw, agency read (exact fact version values, audited with counts).
5. Web: `/collect/account` (signed-in via the request filter and its return path, choose person, item-by-item ticks, Still Missing, consent, Submit to Agency), `/collect/account/answers` (Withdraw Answer), agency Answers panel with exact-version previews. One CSS block, forms registered in a11y-forms.
6. Tests: wrong account neutral and audited once; another traveller's person refused; only approved versions visible through the agency's own read path; later version not shared; revoked or expired request blocks submission; switch off not found; no grant or case created; withdrawal ends access including issued links; append-only triggers.

## Not in this lane
No notification event or rate limit (P8 owns those files). No uploads (P9). No automatic case.
