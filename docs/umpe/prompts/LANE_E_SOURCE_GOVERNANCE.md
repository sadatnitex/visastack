# Lane E: official requirement source monitoring and correction governance (P10/P11)

Independent branch/worktree. Read L3 §1, §3-4 and tests §8, audit IDs `R08-R10`, `S01-S08`. Inspect existing `packs.ts`, Pack Studio, source-review queue, `scripts/country-packs`, manual `country-intake-pages.yml`, Vercel jobs, fallback Render cron mirror and scheduler tests. Do not turn 156 discovery countries into 156 certified visa routes.

## P10 source governance

- Maintain an explicit authoritative-source roster by route/jurisdiction with government/consular/official application and authorized VAC hierarchy. Support bounded fetch adapters for official API/HTML and controlled PDF retrieval/parse where possible. Block SSRF and untrusted redirect/network targets; cap bytes, time, depth, content type, page count, budgets and retries. Site changes may be layout, not law. Preserve source observed date, hash, excerpt, access method, reachability and parser quality distinct from human verification and effective date. Unavailable/anti-bot sources become review exceptions, not fabricated 'checked'.
- Add idempotent **Saturday Asia/Dhaka** schedule using the repo's existing job model; where no owner-selected hour exists, propose 09:00 Dhaka (03:00 UTC, Saturday, cron `0 3 * * 6`) as a recorded configurable default and test UTC conversion/calendar boundaries. Include manual run and targeted urgent recheck for high-risk active package. Make Vercel and Render fallback exact scheduler parity where applicable. Scheduler/auth/path hot files through integration lease only.
- Generate proposed content changes and diff evidence. Reuse author/reviewer separation and immutable pack publication. Never have AI or changed HTML automatically publish substantive mandatory rules. Static content ingestion remains discovery; promote only when qualified official-source verification meets route coverage policy. Record measured number of checked, blocked, changed and reviewed sources.
- Freshness policy at package handoff: if route evidence too old or conflicting, warn honestly, apply conservative state and offer official link/manual review; do not give unsupported 'up-to-date' certification. Only official-source-reviewed pack can support strong submission-ready wording.

## P11 user suggestions and impact

- User/agency proposes a checklist correction with affected route, exact requirement, explanation and source link/attachment. Keep separate from private package overlays; moderation queue verifies, accepts or rejects with reason. Only verified publication changes global pack.
- Published change triggers targeted active-case impact analysis, using actual route applicability and existing selected pack version. Notify relevant affected travellers with exact what changed; no retroactive rehash, rewrite of submitted snapshots or auto-update of issued agency checklists.

## Tests

HTML no-change, semantically changed requirement, layout-only diff, PDF, 304, 403, timeout, malicious redirect, inaccessible origin, conflicting official sources, stale fee and future effective date. Scheduler runs exactly on Saturday Dhaka, retry idempotently and never duplicates candidate. New material rule without reviewer cannot publish; verified rule update gets new version and affected-case signal. Existing historic checksums continue to verify. User correction cannot mutate authoritative pack.

## Route content programme

Create separate editorial coverage ledger: `SUPPORTED_SOURCE_VERIFIED`, `PARTIAL`, `UNVERIFIED`, `UNREACHABLE`, `UNSUPPORTED`, evidence links, reviewer and date. Do not mass-generate 'complete' packs from AI. You may prepare high-priority actual routes for reviewer approval, but do not invent approvals or claims from missing sources. Record editorial backlog separately from code status and tell lead which routes are actually usable.

## Handoff

P10 and P11 separately reviewed, with source examples, rate/diff metrics and candidate change queue. No changes to `apps/web/vercel.json`, schema or publication services without exclusive lease. Keep country directory and verified rule store distinct.
