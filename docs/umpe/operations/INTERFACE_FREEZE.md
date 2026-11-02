# UMPE shared interface contract (proposed; verify and freeze before implementation)

This is an integration contract **for discussion with actual repository types**. No example names here certify an existing API or authorize a new parallel source of truth. The lead must audit, choose canonical names, write the resulting ADR and tests, and publish the final signatures to workers. This prevents months of schema repair and inference from accidental naming.

## Canonical entities to reuse and protect

- Person: `applicants`; confirmed values: `facts`, `factVersions`, evidence links; owner/guardian/consent from existing services.
- Files: `documents`, `documentVersions`, file safety/processing states, hash and lifecycle. Automatic readable names are versions/metadata; original bytes unchanged.
- Requirement authority: `packs`, `packVersions`, `packRequirements` plus verified source fields and existing approval lifecycle. Static `destinations` remain discovery metadata only.
- Trip/case: `missions`, existing precise snapshots, evidence selections, acknowledgement, submissions, application memory. One trip involving multiple persons composes **multiple existing per-person cases**, not a competing case engine.
- Agency: organization membership, existing access policy, grant checks, evidence requests, client invitation and brand profile.
- Delivery: existing notification/outbox, provider adapters, audit, rate limiter and scheduler.

## Minimum cross-lane objects and invariants

**ImportBatch**: caller/request context, controlled set of `ImportItem`s, idempotency key and status. One batch can be processed in bounded chunks. Every file has a clear status (`queued`, `uploaded`, `processing`, `needs_review`, `accepted`, `rejected`, `uncertain` and cancellation as appropriate). Files arriving with unknown owners must remain in a pre-assignment protected staging boundary, never be assigned to arbitrary applicant 1. Item records preserve original filename, relative folder path as private metadata, hash, size, observed type, source, upload attempt and scan status. Staging expires or converts on authenticated/verified owner action. Keep original source record even if a duplicate.

**DocumentInterpretation**: based on `documentVersionId` or a scoped staging item; evidence page/region; extracted field key; original text; normalization; observed/effective dates; confidence and material conflicts. An AI proposal is **not** an approved fact. Person identity candidates are just that until sufficiently verified or confirmed. Preserve existing AI consent, restricted document exclusions, provider budgets and deletion.

**RequirementSpecification**: stable ID and category; destination/visa route, jurisdiction, nationality/residence, travel dates and applicant conditions; `MANDATORY`, `CONDITIONAL`, `ALTERNATIVE_GROUP`, `RECOMMENDED`, `OPTIONAL`, `ADDITIONAL_REQUEST` plus `NOT_APPLICABLE/UNVERIFIED` as evaluation states rather than false mandatory values; source URL/publisher/extract/observed/verified/effective dates; acceptable document/fact types, alternative groups (any-of/all-of), specified format and source-supported freshness. **Never mix this taxonomy with `PROFILE_PACKS` used for grant scope.** A generated checklist is a projection of immutable authoritative pack version + separately labelled agency overlay and user choices.

**PackCompatibilityProtocol**: Existing published `buildManifest` serialization/checksum must remain byte-for-byte compatible. For new structure, choose a versioned manifest format or compatible sidecar metadata with explicit serializer selection. Test at least one old pre-change frozen manifest, checksum and case mapping. New authored rule conditions fail closed on invalid AST; unknown conditions do not become falsely applicable or satisfied. Do not mutate existing published versions.

**PackageSelection**: references `packVersionId`, applicable requirement IDs, `factVersionId` and `documentVersionId` with exact selected copies; flags for replaced/expired/unknown; user/agency supplemental item source; consent/permission, acknowledgement, issuance and handoff timestamps. Live proposal may recompute; previous issued/approved snapshots may **not** mutate. Distinguish `PREPARED`, `SHARED`, `RETRIEVED`, `REVIEWED`, `ACCEPTED_BY_AGENCY`, `REPORTED_SUBMITTED_EXTERNALLY`, `OFFICIALLY_ACKNOWLEDGED` and `AUTHORITY_DECIDED` (use actual existing enum/status names where possible). Versioned package snapshots must have stable replay under later evidence changes.

**GroupTrip**: journey-level intent and participant links, with *one case per person*. Preserve existing `itineraryRef` compatibility. Each traveller's nationality/residence/age/funding/sponsor/privacy is independent; common travel evidence is referenced only with required permissions. Guardian authorization and adult consent cannot be inferred from a family dropdown.

**AgencyCollectionRequest**: organization+authorized staff, route, tentative date, optional recipient identity hint, immutable issued checklist revision anchored to `packVersionId` and explicit agency overlay. It exists **before** an `applicantId`, `missionId` or personal grant. Never use lead/opportunity objects as prerequisites. Draft can edit; issue freezes checklist; reissue creates next version. Link stored hashed, revocable, expiring, rate-limited. Agency-specific requests are not official rules.

**GuestCollectionSession**: verified recipient proof bound to one issued request, limited cookie/session scope and expiry. A public WhatsApp URL alone can display neutral agency branding and instructions, but never a client's draft documents, names, private checklist or responses. For email-available recipients, consider low-friction email code via existing mail adapter without creating an auth account; verify implementability, expiry, brute-force protection and cost. For phone-only recipients, require a *real* authorized proof mechanism or a clearly restricted alternative; never invent WhatsApp sender integration or accept link possession as identity. Resume is through a fresh verified session and same request, not by anonymous file URL.

**GuestUploadItem / GuestReceipt**: request-scoped ownership and storage, processed via existing scanner/extraction adapters without creating fake `applicantId` or permanent personal wallet. Limited AI processing only under explicit guest consent and allowed provider configuration. Map selected exact versions against issued checklist, preserve separate submitted revisions and agency corrections. Agency gets auditable receipt and permitted files; guest has no durable personal VisaStack history absent later explicit account consent. Retention and purge mechanisms must remove underlying bytes and restrict access across revoked/expired sessions; legal holds handled via existing pattern.

**SourceObservation**: official source registry with stable route mapping, ETag/content hash/fetchedAt/access status/content format, candidate diff, source excerpt, verifier and verifiedAt, effective date, publication event and affected pack revision. A fetched page is not verified regulatory truth. Restricted, inaccessible and PDF sources are reportable exceptions, not fabricated checks. Scheduler must be idempotent and use the existing cron authentication/scheduled worker model; Saturday is `Asia/Dhaka`, compute UTC schedule explicitly, and do a final package freshness check separately.

**OutcomeAttempt**: exact attempted application context plus reported submission or evidenced authority receipt, exact selected pack/version, exact submitted evidence versions, source and quality of decision, unknown/pending states, separate agency internal requests and actual authority requests. Multiple submissions and decisions never collapsed into one success. Use aggregate thresholds, privacy protections and missing-outcome denominators. No approval probability or causal recommendations from observed correlation.

## Cross-lane events and single-writer policy

The following *semantic* events trigger reevaluation, but names must align with existing `product-events.ts` closed vocabulary and `notifications.ts` interfaces. Integrator is responsible for introducing new event labels and updating tests in the same PR.

- Intake item safely processed -> classify/interpret and propose person/document relations.
- User confirms material profile fact or document choice -> find impacted active packages and mark affected selections for review.
- A newer relevant document arrives -> notify when package has an older selected version; **do not auto share**.
- Published rule version changes -> compare affected active packages; old issued/checksum versions stay untouched.
- Agency issues/reissues/revokes checklist -> update permitted recipient link and guest access without revealing unrelated requests.
- Guest submits exact receipt or agency requests correction -> update only that request's status, exact revision and audience.
- External outcome reported -> record provenance and add to private insights only when authorized for that purpose.

## Changes that require an ADR and owner involvement

- Exact document/public link permission expansion, storing new sensitive identifiers, guest retention policy beyond existing terms, changing external commercial claims, provider/data residency and actual production sensitive-data activation.
- New central schema and migration shape (review before merge), existing pack serialization version changes, any broad switch from manual to automatic legally relevant declaration, official publication authority policy.
- Preserve reversion capability for additive code. Postgres applied migration rollback normally requires tested forward fix rather than casually reversing a production migration.

## Contract verification fixture set

1. Historical published manifest checksum before/after upgrade matches byte-for-byte.
2. A mandatory requirement plus alternative set is satisfied by exactly one valid option; recommended missing never blocks.
3. A conditional criterion absent yields unverified, not falsely not-applicable.
4. Three-person batch has three clear passports, one ambiguous passport, duplicate scan, two statement periods and changed employer letter; never cross-assign uncertain files.
5. Existing-user request chooses the correct profile, shares approved exact document versions only.
6. Guest request does not create an `accounts` or `applicants` row, and cannot access another guest's upload even with a forwarded link.
7. Submitted receipt remains replayable after later file replacement or rule update, subject to lawful deletion rules.
8. Saturday source fetch finds a material change but cannot mutate a published rule without the authorized publication path.
9. Two authority submission attempts with different outcomes appear as two outcomes with provenance; missing decisions remain unknown.

The lead should freeze this interface only after inspecting actual exported services and test helpers. Workers must explicitly accept the finalized contract before writing dependent code.
