# P1 packs discovery (HEAD d17d717c). Paths relative to /home/user/visastack

## 1. Manifest and checksum
- `buildManifest(requirements)` packages/services/src/packs.ts:57-83. Items map to exactly 5 keys in this order: `kind, fieldKey, docType, citation, optional` (:72-78). Missing fieldKey/docType serialize as `null`. Sort is `JSON.stringify(a).localeCompare(JSON.stringify(b))` (:79; locale-dependent, risk to note). Manifest = `{requirements: items}`; checksum = sha256 hex of `JSON.stringify(manifest)` (:80-81).
- Excluded on purpose: notes, maxAgeDays, condition, sourceUrl/publisher/extract/interpretation, observedDate (comment :60-70 warns any new key breaks every old version).
- `approvePackVersion` (:469) stores `manifest` and `checksum` (:538-548). `verifyPackChecksum` (:1187-1192) RECOMPUTES from current rows via `listRequirements`, it does not hash the stored manifest. So any new key emitted for old rows breaks verification. Admin manifest download route (apps/web/src/app/app/admin/packs/[packId]/versions/[versionId]/manifest/route.ts:21) also rebuilds from rows.
- No golden test exists. packs.test.ts only round-trips (:115-126, :486 `verifyPackChecksum` true after approve; only a `/^[0-9a-f]{64}$/` shape check). No hard-coded hash anywhere in services tests. Must add one.

## 2. Schema (packages/db/src/schema.ts)
- `packs` :2119: key, name, jurisdiction, route, purpose, nationalityApplicability[], residenceApplicability[], authoritative, ownerOrganizationId.
- `packVersions` :2148: status, manifest jsonb, checksum, approvedBy/At, publishedAt, nextReviewDate, effectiveDate, supersededAt, withdrawn*, routeDescription, officialFee*, publicTrustPublishedAt.
- `packRequirements` :2242: kind (enum FIELD|DOCUMENT :173), fieldKey, docType, citation NOT NULL, `optional boolean notNull default false` :2255, notes, maxAgeDays, `condition jsonb` nullable, sourceUrl/Title, publisher, officialExtract, interpretation, sourceType, observedDate, authorAccountId, changeReason, sourceInaccessibleAt.
- Missing: necessity enum, group/alternative key, agency-overlay provenance, verifiedDate, per-rule effective date, route/jurisdiction per rule.
- `optional` in readiness (missions.ts): required = `!optional` counts toward `requiredCount/satisfiedRequired` (:1053-1056); `ready = requiredCount>0 && all satisfied` (:1080); optional gap still pushed to `missing` with `optional:true`; resolve state ATTENTION vs CRITICAL_GAP (:1352-1353); overall state only looks at `!r.optional` (:1378). So optional = Recommended = Optional (one boolean).

## 3. rule-conditions.ts
- AST `RuleCondition` :50-83 ops: exists, equals, notEquals, memberOf, dateBefore/After, durationAtLeast/AtMostDays, numberAtLeast/AtMost/Between, and, or, not. Operands literal|field|now (:45). Reserved fields `case_travel_start/end` (:35-36).
- Result `'true'|'false'|'unknown'` (:85). Missing fact => `unknown` (:148-152); Kleene and/or/not (:123-139). Wrong type => unknown.
- `isValidRuleCondition` :270-346 (allowlist; no depth or size limit). `addRequirement` rejects invalid (packs.ts:262-264). `approvePackVersion` does NOT re-validate stored conditions.
- Invalid AST at read time FAILS OPEN: `evaluateRequirementCondition` missions.ts:1397-1403 returns `null` (= unconditional) for invalid or null. Also used in prepare-again (:3145).
- Unknown cascade: `resolveRequirementResultState` missions.ts:1341-1354 (false=>NOT_APPLICABLE; conflict/stale; satisfied; unknown=>UNVERIFIED; else ATTENTION/CRITICAL_GAP). `deriveOverallReadinessState` :1372-1394 (required UNVERIFIED => NEEDS_REVIEW). Caveat: satisfied evidence wins over unknown condition (:1327-1331).

## 4. pack-matching.ts (listFittingPublicPacks :133, findMatchingPublicPack :195)
- Dimensions: jurisdiction=country, purpose, nationalityApplicability, residenceApplicability only. Authoritative, ownerless, newest PUBLISHED version only (:149-166).
- Unknown nationality/residence => pack listed with `coversTraveller:false`, never auto-linked (:118-122, :195-201). Known mismatch => excluded.
- NOT considered: `packs.route` (header doc says so, :23), application/consular location, travel dates, age/guardian, funding, visa subroute, effective date. Multiple fits => no auto-link (R05 PARTIAL).

## 5. Alternatives / recommended / necessity / overlay
- Grep over packages and apps: zero hits in pack or readiness code (only unrelated words). Nothing exists. Static `DestinationRequirement` (packages/core/src/destinations/types.ts:36-43) has `optional`, `onlyWhen` free text, no groups.

## 6. PROFILE_PACKS
- packages/core/src/domain.ts:187-193 (universal, professional, business, medical, medical_attendant); used by core/catalogue/{packs-entry,types,report}.ts and sharing-grant scope (SHARING_CATEGORIES types.ts:13). Separate from DB `packs`/`packRequirements` (confirmed; different tables and vocabulary).

## 7. Static destination data
- packages/core/src/destinations/{batch-001.json,index.ts,types.ts,country-codes.json}; built by scripts/country-packs/build-destinations.mjs. Consumers: apps/web/src/lib/country-view.ts, country-start.ts, case-choices.ts, app/app/countries/[iso2]/page.tsx, services/country-start.ts (analytics only).
- Not presented as verified: types.ts:1-7 says unresearched is never "no visa needed"; country-view.ts:43-70 shows "Checked on", "Not from an official page", "Needs checking" notes. Many entries carry "page did not contain the copied words" notes. No link to readiness; readiness comes only from published packs via case-checklist-match.ts. Residual risk: UI labels not enforced by a test that thin routes never show green.

## Ledger status
| Row | Status | Evidence |
|---|---|---|
| R01 | IMPLEMENTED | packs/packVersions/packRequirements, Pack Studio, immutable approve/publish; no golden checksum test |
| R02 | PARTIAL | kind FIELD/DOCUMENT only; no taxonomy column; PROFILE_PACKS separate |
| R03 | PARTIAL | only `optional` boolean + `condition`; no enum |
| R04 | MISSING | no group concept, one row = one gap |
| R05 | PARTIAL | `packs.route` stored but ignored; matching on country/purpose/nationality/residence |
| R06 | IMPLEMENTED | tri-state AST, unknown=>UNVERIFIED |
| R07 | PARTIAL | add-time validation only; read-time invalid => null (fail open); no approve/publish gate |
| R09 | PARTIAL | destinations JSON with source/checkedOn labels; separate from packs |
| F03 | PARTIAL (out of this lane, untested here) | AuthorizedApplicant gate used by readTravellerCoverage :208 |
| F04 | IMPLEMENTED (not reviewed deeply) | profile.ts unaffected by pack code |

## Minimal additive design (no checksum change for published versions)
1. Schema (nullable, no defaults that change old rows): `pack_requirements.necessity` (enum MANDATORY|CONDITIONAL|ALTERNATIVE_GROUP|RECOMMENDED|OPTIONAL|ADDITIONAL_REQUEST, NULL = legacy, derive from `optional`), `group_key text`, `group_mode` (ANY_OF|ALL_OF), `provenance` (OFFICIAL|AGENCY_ADDED), `verified_date`. `pack_versions.manifest_format int` NULL = v1.
2. `buildManifest(requirements)` becomes `buildManifest(requirements, format: 1 | 2 = 1)`. Format 1 body stays byte-identical (same 5 keys, sort, stringify). Format 2 spreads extra keys only when non-null (`...(r.necessity ? {necessity} : {})`, groupKey, groupMode, provenance, condition) AFTER the legacy five, and adds `formatVersion: 2`. Keep deriving `optional` true for RECOMMENDED/OPTIONAL so old readers agree.
3. Call sites to change: `approvePackVersion` packs.ts:538 (choose 2 iff any row has new fields, write manifest_format), `verifyPackChecksum` :1190 (pass `version.manifestFormat ?? 1`), manifest route.ts:21, `RequirementInput`/`addRequirement` (validate group_key with mode, necessity vs optional consistency, CONDITIONAL requires condition), `DIFFABLE_SCALAR_FIELDS` :1248.
4. Readiness (missions.ts): add `necessity`, `groupKey` to `RequirementMapping` (:1255) and `RequirementResultSummary` (:574). In `computeReadiness` (:1007) collapse each ANY_OF group after `buildRequirementMapping`: satisfied if any member satisfied, emit one `MissingRequirement` per unsatisfied group, count group as one required. `resolveRequirementResultState` (:1341) takes `necessity`: RECOMMENDED/OPTIONAL/ADDITIONAL_REQUEST never CRITICAL_GAP (ATTENTION); `deriveOverallReadinessState` (:1372) filters on blocking necessity, not `!optional`.
5. UNVERIFIED / fail closed: change `evaluateRequirementCondition` (:1397) so for v2 versions an invalid or unparsable condition returns `'unknown'` (or a new `'invalid'`) instead of `null`; add a publish/approve gate re-running `isValidRuleCondition` on every row and rejecting CONDITIONAL rows without conditions. Also make unknown condition beat satisfied evidence only if rule demands it (decide with owner).
6. Tests: add frozen v1 fixture (fixed rows, hard-coded manifest JSON and sha256, plus `verifyPackChecksum` on a row inserted with new columns NULL) in packs.test.ts before touching buildManifest; add rule-conditions fail-closed and group-resolution tests.
