# P10 discovery: source monitoring, Saturday check, outcomes (HEAD d17d717c, read-only)

## 1. Scheduler
- 21 daily crons in apps/web/vercel.json (all `M H * * *`, UTC; last: process-billing-cycle `15 6`, database-backup `7 11`). Handlers: apps/web/src/app/api/jobs/<name>/route.ts (no api/cron dir).
- Route pattern (copy process-rate-limit-prune/route.ts): `export const dynamic='force-dynamic'; maxDuration=60; GET(request)` whose first two body lines are exactly `const denied = rejectUnauthorizedCron(request);` / `if (denied) return denied;`, then `Response.json(await triggerX())` from apps/web/src/lib/jobs.ts (trigger* wrappers open a short pool, call services, reportServerError).
- Auth: apps/web/src/lib/cron-auth.ts:15-24, `Authorization: Bearer $CRON_SECRET`, sha256+timingSafeEqual, 503 if secret unset. apps/web/src/lib/cron-auth.test.ts:42-63 scans EVERY dir under api/jobs and enforces the two-line preamble and no `CRON_SECRET`/authorization header in route code (a new route that deviates fails).
- Render mirror: .github/workflows/render-cron.yml has two lockstep lists: `on.schedule` cron lines (l.33-53) and `CRON_TABLE` block (l.89-110, `min hour dom mon dow /path`). Selection matches the exact 5-field schedule string (l.123-131), concurrency group per schedule. scripts/render-cron.test.mjs:41-52 asserts CRON_TABLE == vercel.json crons and trigger set == vercel schedule set (no duplicate trigger strings). `0 3 * * 6` is a distinct string from `0 3 * * *`, so no collision. Header comment (l.1-27) and docs/operations/render-fallback.md:104 say "all daily" - update wording.
- Hobby limit: routes document "Vercel Hobby rejects any cron firing more than once a day" (api/jobs/process-notifications/route.ts:11-17; process-notification-sweeps/route.ts:15). Weekly is within limit. Production was paused 30 Oct 2026 by Hobby CPU fair-use (CLAUDE.md:80): the Saturday job must be light (bounded fetch count, small bytes), dry-run only.
- Lockstep checklist for a new job: (1) apps/web/vercel.json (HOT) (2) render-cron.yml schedule line + CRON_TABLE (HOT) (3) route.ts + route.test.ts (4) jobs.ts trigger wrapper (HOT, shared) (5) services function + export via packages/services/src/index.ts (HOT barrel) (6) optional addition to scheduled-jobs-outage.test.ts (7) docs/operations/render-fallback.md wording. supply-chain checks (scripts/supply-chain/checks.mjs:513-585) only guard render-cron secret/guard, not the table.

## 2. Existing source code
- Per-requirement: packages/db/src/schema.ts:2254 `citation`, :2280 `sourceUrl`, :2281 sourceTitle, :2282 `publisher`, :2287 officialExtract, :2293 `observedDate`, :2304 `sourceInaccessibleAt`. Version-level: officialChannelUrl/officialReportingUrl (~2218-2225), `officialFeeStaleAt` (~2213), nextReviewDate, effectiveDate.
- packs.ts: `recordRequirementSourceReview` (l.326, human sets sourceUrl/observedDate), `markRequirementSourceInaccessible`/`clear...` (l.730-740), `markOfficialFeeStale` (l.998), `listPackVersionsDueForReview` (l.1210), `diffPackVersions` (l.1297, natural-key diff), `sourceRecordsComplete` gate in publish.
- Product event SOURCE_REVIEWED labels incl SOURCE_UNREACHABLE (product-events.ts:68,172-178).
- No registry table, no fetch history, no hash/ETag, no freshness at handoff. Only fetcher: scripts/country-packs/fetch-pages.mjs (l.46 pool 8, l.129-136 fetch `redirect:'follow'`, 25s timeout, skips PDF), run only by manual .github/workflows/country-intake-pages.yml (workflow_dispatch only, no secrets/DB).

## 3. Pack lifecycle (packages/services/src/packs.ts)
- States DRAFT -> APPROVED -> PUBLISHED -> WITHDRAWN (schema.ts enum ~168-171/252-254). createPack l.122, addPackVersion l.182, addRequirement l.231, approvePackVersion l.469 (locks row; authoritative pack: approver != authoredByAccountId else `forbidden`; default next review 30d, longer needs reason; freezes manifest+checksum), publishPackVersion l.589 (re-checks approver != author, nextReviewDate in future, sourceRecordsComplete: sourceUrl http(s), title, publisher, citation, observedDate not future, sourceInaccessibleAt null), withdrawPackVersion l.681, verifyPackChecksum l.1187. All admin actions gated by `hasPlatformPermission(..., 'PACK_MANAGE')` (admin/packs/actions.ts:58 etc). S04 base is solid: new work must only create DRAFT versions/candidates, never call approve/publish.

## 4. Outbound fetch policy
- No general guard. Only SSRF-grade code: packages/services/src/ai-clients.ts - `isPublicAddress` (l.322, exported), DNS lookup + all-public check (l.515-545), `redirect:'manual'`, 5s timeout (l.79), 64KiB cap `readCapped` (l.467), host allowlist, content-type check. packages/adapters has no fetch except payment.ts:512. Reuse isPublicAddress + readCapped patterns; per-hop redirect validation is new. DNS-rebinding caveat noted at ai-clients.ts:535.

## 5. Outcomes and events
- outcomes.ts:32-134: `recordOutcome` (owner-only via getMissionForOwner, step-up required, decision APPROVED|REFUSED|WITHDRAWN|CANCELLED|OTHER, decisionDate not future, officialWording and agencyInterpretation separate columns, optional evidenceDocumentId), `listOutcomesForMission`. No prediction (header l.7-20). Does not store pack version/attempt link beyond mission pin.
- product-events.ts: closed `PRODUCT_EVENT_TYPES` l.47-110, per-event label vocab map ~l.150-190 (OUTCOME_RECORDED l.182), `PRODUCT_EVENT_CATEGORIES` l.388, `recordProductEvent` l.274 (savepoint, never blocks). Adding an event type = edit this file (HOT) plus its test.

## 6. Admin
- apps/web/src/app/app/admin/packs/page.tsx (Review Queue card l.125-160, uses listPackVersionsDueForReview), admin/packs/[packId]/{page,versions,diff}, actions.ts, pack-forms.tsx, pack-version-buttons.tsx. Natural home: new admin/packs/sources/ page. Other admin dirs: report, audit, security, ai, complaints.

## Ledger status (actual)
| Row | Status | Evidence |
|---|---|---|
| R08 | PARTIAL | per-requirement sourceUrl/publisher/observedDate + version effectiveDate; no fetched-vs-verified dates |
| R10 | CONTENT-GAP | editorial; code cannot fill; add coverage ledger/audit only |
| S01 | GAP | no weekly job; only daily crons; intake workflow manual |
| S02 | PARTIAL | fetch-pages.mjs HTML only, skips PDF, follows redirects, no adapters |
| S03 | PARTIAL | review queue + diffPackVersions (version vs version); no source-observation diff |
| S04 | BASE (confirmed) | approve/publish author!=reviewer enforced in packs.ts:469,589 |
| S05 | GAP | no handoff freshness check (P10 scope: policy only, needs missions/handoff hook) |
| S06,S07 | GAP | P11, out of P10 |
| S08 | PARTIAL | citation/trust labels exist; no official/agency/field-observation distinction |
| O01 | BASE | submissions.ts, missionSubmissions (P12) |
| O02 | BASE | outcomes.ts as above (P12) |
| O03-O06 | PARTIAL/GAP | no attempt model, no authority-request event, no denominators/cohorts (P12) |
| O07 | BASE | outcomes.ts header disclaims prediction (P12) |
P10 owns R08,R10,S01,S02,S03,S04,S05,S08; O* are P12.

## Minimal additive design (dry-run, never mutates published packs)
Schedule: Dhaka = UTC+6, no DST. Saturday 09:00 Dhaka = Saturday 03:00 UTC = cron `0 3 * * 6` (Vercel and GitHub cron both UTC, dow 6 = Saturday). Dhaka Saturday spans Fri 18:00Z-Sat 18:00Z; 03:00Z is unambiguous. Use pure helper `isSaturdayInDhaka(now)`/`dhakaWeekKey(now)` for idempotency key (ISO week in Asia/Dhaka) so retry/late GitHub start does not duplicate.
Tables (new migration 0115, re-runnable CREATE TABLE IF NOT EXISTS, additive):
- `official_sources` (id, routeKey/jurisdiction, url, kind official_api|html|pdf|vac, authorityTier, packRequirementId nullable, active, maxBytes, createdBy).
- `source_observations` (id, sourceId, runKey unique with sourceId = idempotency, fetchedAt, httpStatus, outcome fetched|not_modified|blocked|timeout|redirect_refused|too_large|pdf_unparsed|error, etag, lastModified, contentSha256, normalizedTextSha256, byteLength, excerpt, parserQuality).
- `source_change_candidates` (id, sourceId, observationId, prevObservationId, diffExcerptOld/New, status NEW|IN_REVIEW|DISMISSED_LAYOUT|ACCEPTED_TO_DRAFT, reviewerAccountId, decidedAt, linkedDraftVersionId). Candidates never alter packs.
- `source_check_runs` (runKey unique, startedAt, finishedAt, trigger scheduled|manual, counts checked/blocked/changed). Gives measured counts.
Service: packages/services/src/source-monitor.ts (new): registry CRUD, `runSourceCheck(db, {fetcher, now, trigger})` with injected fetcher port (testable: 200/304/403/timeout/redirect/PDF/oversize). Fetcher adapter new file in packages/adapters/src/official-source-fetch.ts: https only, host must be in registry, per-hop manual redirect re-validation, isPublicAddress (export from services or copy into adapters), byte/time/page caps, conditional GET with If-None-Match, text normalisation to ignore layout. Unavailable/anti-bot -> outcome blocked + review exception, never "checked".
Route: apps/web/src/app/api/jobs/process-source-check/route.ts (+route.test.ts) with required preamble; `?mode=` manual via admin action instead of cron params.
Admin: apps/web/src/app/app/admin/packs/sources/page.tsx (+ actions.ts gated by PACK_MANAGE): registry, last run counts, blocked list, candidate queue with old/new excerpt; "create draft" only calls addPackVersion/addRequirement as DRAFT; approve/publish untouched (S04).
Hot files to change (integration lease): apps/web/vercel.json; .github/workflows/render-cron.yml (schedule + CRON_TABLE); apps/web/src/lib/jobs.ts; packages/services/src/index.ts; packages/db/src/schema.ts (+ migrations/_journal.json, new 0115 sql); packages/services/src/product-events.ts only if adding SOURCE_CHECK events (optional: reuse SOURCE_REVIEWED labels SOURCE_UNREACHABLE; avoid otherwise).
Non-hot edits: docs/operations/render-fallback.md:104 wording; scripts/render-cron.test.mjs unchanged (passes if both lists updated); schema.test.ts table-presence tests.
New files: migration 0115; source-monitor.ts(+test); official-source-fetch.ts(+test); process-source-check route(+test); admin sources page(+actions, +tests); optional coverage-ledger doc for R10.
Tests required (lane brief): no-change, 304, changed requirement, layout-only, PDF, 403, timeout, malicious redirect, UTC/Dhaka boundary, idempotent retry, candidate dedupe, published pack row and checksum unchanged after run.
Cautions: Hobby weekly OK; keep run small (CPU pause history); first deploy before migration applies must degrade (see schema.test.ts:658 pattern: "tables missing -> no-op").
