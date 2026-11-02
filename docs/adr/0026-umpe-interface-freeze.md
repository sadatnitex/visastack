# ADR 0026: UMPE interface freeze v1 (shared contracts for parallel lanes)

- Status: Accepted (lead), 2 November 2026. Base: `origin/main` `d17d717c`.
- Context: the owner's UMPE programme (`docs/umpe/`, locked product contract plus implementation kit) runs several implementation lanes in parallel. The kit's `operations/INTERFACE_FREEZE.md` is a draft; this ADR is the verified, binding version for the decisions lanes need now. Everything not listed here is unfrozen and must not be assumed.
- Evidence: read-only discovery of the real code at `d17d717c` (packs, rules, import, agency and guest, source monitoring), baseline tests (8 files, 212 tests, green), and the new golden test `packages/services/src/umpe-no-loss-golden.test.ts`.

## Decisions

### D1. Published pack manifests are frozen at format 1
`buildManifest` (packages/services/src/packs.ts) emits exactly five keys per requirement (`kind, fieldKey, docType, citation, optional`), sorts items by `JSON.stringify(a).localeCompare(JSON.stringify(b))` and hashes `JSON.stringify({requirements})` with sha256. `verifyPackChecksum` recomputes from the current rows, so any new key emitted for an old row breaks every historic version. This output is now pinned by a golden checksum (`daf22ce5...5045`) and a proof that adding one key turns the guard red.

Two facts found and pinned:
1. The format 1 sort uses `localeCompare` (ICU collation, for example `Employer_Letter` sorts between `bank_statement` and `hotel_booking`). It stays exactly as is for format 1.
2. Postgres `jsonb` reorders the keys of the stored `manifest`, so the stored manifest is equal in content but not byte-identical to the checksummed text. A verifier must never hash the stored jsonb; it recomputes from rows or canonicalises first.

### D2. New rule semantics use a versioned serializer, never a changed one
- `pack_versions.manifest_format` (nullable integer, NULL means 1) will be added in the P1 schema slot.
- `buildManifest(rows, format = 1)`: format 1 is byte-identical forever. Format 2 adds `formatVersion: 2`, sorts by plain code-point order (locale independent), and appends new keys after the legacy five only when they are non-null.
- `approvePackVersion` chooses format 2 only when a row uses a new field; `verifyPackChecksum` and the admin manifest download pass the version's own format.
- Existing approved or published versions are never rewritten.

### D3. Necessity is separate from evaluation state and from sharing categories
- Authoring necessity (new nullable `pack_requirements.necessity`): `MANDATORY`, `CONDITIONAL`, `RECOMMENDED`, `OPTIONAL`, `AGENCY_ADDED`. NULL means legacy and is derived from `optional`: `false` maps to `MANDATORY`, `true` to legacy non-blocking (shown as Optional; the old boolean never distinguished recommended from optional, and we do not invent that meaning).
- Alternatives: nullable `group_key` plus `group_mode` (`ANY_OF` only in v1). One satisfied member satisfies the group; the group counts once; members are never double counted.
- Evaluation state stays the existing `RequirementResultState` vocabulary. `NOT_APPLICABLE` only when a condition evaluates to false; a missing fact gives `UNVERIFIED` (pinned by the golden test). For format 2 rows an invalid stored condition gives `UNVERIFIED` (fail closed). Format 1 rows keep today's behaviour (an invalid stored condition is treated as unconditional, which demands the item rather than hiding it).
- `RECOMMENDED`, `OPTIONAL` and `AGENCY_ADDED` never produce a blocking gap.
- `PROFILE_PACKS` / `SHARING_CATEGORIES` (packages/core) remain the only sharing-scope vocabulary and are never used for requirements, and vice versa.

### D4. Agency collection requests exist before any person record
- New tables (P6 slot) hold `organization_id`, the issuing account, route intent, an append-only revision table anchored to `pack_version_id` plus pack checksum and a separately labelled agency overlay, and a link table storing only a token hash (reusing `generateInvitationToken` / `hashInvitationToken`), with expiry, revocation and reissue history.
- These tables carry no `applicant_id`, `mission_id`, `owner_account_id`, `document_id` or `document_version_id` column, so they stay outside the access ratchet without baseline entries.
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
- Lanes develop in separate local worktrees. Only the session's designated branch may be pushed, so lanes land as sequential PRs from that branch unless the owner allows `umpe/*` branches.

## Consequences
Lanes A (import) and E (source monitoring) can build now. Lane B (P1 necessity and alternatives) takes the next schema slot after Lane E lands. Lanes C and D start after P1, with D gated on the owner's guest-proof decision. Contract changes are made by superseding this ADR, never by editing a frozen format.
