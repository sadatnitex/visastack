# Scroll Budget programme (WP-SB): plan for parallel sessions

Owner request, 31 Oct 2026: no page should need too much scrolling, for every kind of user (traveller, public visitor, agency member, agency admin, staff, platform owner), and every log or long list must sit in a fixed-height window that scrolls inside, with filters. This file is the whole plan. Each session reads its own package section only, plus sections 1 to 4.

Baseline: main `2d71a89c` (31 Oct 2026). The audit behind this plan read the code on that line of history; it did not render signed-in pages. Every package must re-check its own facts before editing (section 3, rule 3).

## 1. Targets (the acceptance standard for every package)

Measured at a phone viewport of 390 by 844 pixels (one screen = 844 px) and a desktop viewport of 1280 by 800, at the default depth (Glance on a phone) and at Browse. Everything may be longer, but lists stay capped.

| Page kind | Phone budget | Rule |
|---|---|---|
| Public landing | 6 screens (5,064 px) | One idea per screen; main action visible on the first screen |
| Dashboard or overview | 2 screens (1,688 px) | Status and the next action on the first screen |
| Task, form, settings | 3 screens (2,532 px) | Split into steps, tabs or collapsible groups; Save or Next in a sticky bar |
| Review (approve what was found) | One card per screen | Sticky bulk action |
| Plain list | 10 rows for travellers, 25 for agency and staff | Then Show More (server-side) |
| Log, history, activity, audit, queue | Fixed panel: 26rem desktop, 22rem phone (existing `.activity-log-scroll`) | Scrolls inside; filters (search, type, who, result, period); server limit 50 per load; Show Older Entries cursor |
| Legal pages | No limit | |

Every list read from the database gets a server-side limit. No page may load an unbounded list, even if it shows only part of it.

## 2. Waves and the order of merges

```
Wave 0  SB0 Foundations ............................ 1 session, merges first
Wave 1  SB1 SB2 SB3 SB4 SB5 SB6 SB7 SB8 ............ 8 sessions in parallel, after SB0 is on main
Wave 2  SB9 Billing surfaces ....................... 1 session, after paid traveller plans T5 and T6 are merged
Wave 3  SB10 Integration and enforcement ........... 1 session, last
```

- Start Wave 1 only when SB0 is merged and live: every Wave 1 package builds on its components.
- Recommended pacing for Wave 1: two batches of four sessions (SB1 to SB4, then SB5 to SB8). That keeps merges, deployments and the Vercel daily deployment limit manageable. All eight at once is possible; the file split below makes them independent, but merges still go one at a time.
- Merge order inside a batch: whichever is green first. Before its last CI run, each branch merges current main (never rebase, never force-push someone else's branch).
- The paid traveller plans work (ADR 0025, T4 to T7) is running at the same time. Wave 1 does not touch its files (section 4). SB9 waits for T5 and T6.

## 3. Rules every session follows (paste with the package prompt)

1. One package per session. Read CLAUDE.md, this file's sections 1 to 4, and your package. Nothing else unless a dependency forces it.
2. Preflight per CLAUDE.md section 6. Your first commit is your allowlist `docs/upgrades/programme/allowlists/WP-SB<n>.txt`, copied from your package's seed. Before finishing, `node scripts/programme/check-allowed-paths.mjs docs/upgrades/programme/allowlists/WP-SB<n>.txt --no-emdash --exclude docs/design/harbor-v2` must exit 0.
3. Re-check before you edit: confirm each file, function and line this plan names still exists on current main. If a fact is false, stop and report; do not improvise.
4. No migrations, no CI workflow edits (only SB0 asks the owner for one line), no global config changes, no changes to permissions, consent, sharing rules or who can see what. A page that shows fewer rows must still apply the same access checks.
5. Server limits: add an optional `options` argument to the existing service function (`{ limit?: number; before?: string }`), defaulting to today's behaviour, so other callers are unaffected. Use SB0's `paging.ts` helpers for the cursor. Do not add new exports to `packages/services/src/index.ts` (SB0 is the only package that edits it).
6. Cursors are opaque, signed or validated on read, and scoped to the same applicant, organization or staff view as the page. A malformed or foreign cursor gives the first page, never an error page and never another tenant's rows. Order by a stable key (the time column plus id; the audit log by its sequence number).
7. Shared files: `apps/web/src/app/globals.css` takes only an appended block that starts with `/* WP-SB<n> ...` (resolve conflicts with `scripts/agent/merge-css.py`). `docs/commercial-v1/known-issues.md` takes only an appended chunk (`scripts/agent/merge-append.py`). Do not edit `STATUS.md`; SB10 writes it. Append your own rows to `COVERAGE-LEDGER.csv` only.
8. Wording: labels in Title Case ("Show More", "Show Older Entries", "Mark All Read"); "case", never "mission", in visible text. `apps/web/src/lib/title-case.test.ts` and `vocabulary.test.ts` must pass. No em dashes anywhere.
9. Accessibility: a scrolling panel is a focusable region with a name (the existing log panel already does this). Show More is a real link that keeps focus near the new rows, with the count announced politely. Sticky bars never cover the last field (add bottom padding) and respect safe-area insets. Respect reduced motion.
10. Tests: for each page you change, a page test that renders a worst-case data set and asserts the row cap, the Show More or Show Older link, the panel class and the filters. One file of browser budget checks per package in `apps/web/e2e/scroll-budget/` (section 5). Prove every new guard can fail by breaking the real code once.
11. Reviews: `/code-review` at high for every package; at max for SB1, SB5 and SB6 (personal data and staff views). `/security-review` for any package that changes a service read (all except SB7). `design:accessibility-review` on changed screens.
12. Local verification once, as one background run of `scripts/agent/full-check.sh`, then a draft PR with the template headings. Do not merge: Programme X needs the owner's explicit merge word for every PR. After merge, the post-merge checks in CLAUDE.md section 6.

## 4. File ownership (what keeps sessions out of each other's way)

Each file belongs to exactly one package. A file not listed belongs to nobody in this programme and must not be edited.

| Package | Owns (pages, components and service functions) |
|---|---|
| SB0 | `apps/web/src/components/activity-log.tsx`, new `components/show-more.tsx`, `components/sticky-action-bar.tsx`, `components/collapsible-group.tsx`, new `apps/web/src/lib/paging.ts`, new `packages/services/src/paging.ts`, `packages/services/src/index.ts` (one export line), new `apps/web/e2e/scroll-budget/support.ts`, `apps/web/e2e/fixtures/*`, `.github/workflows/pr-browser-checks.yml` (one line, owner approval) |
| SB1 | `applicant/[id]/history/**`, `applicant/[id]/memory/**` (including compare), `app/privacy/page.tsx` (consent history only), `app/notifications/**`; `profile.ts` (`listFactHistory`, `listApplicantProfile` options), `application-memory.ts` (`getApplicationMemory`), `consent.ts` (`listConsentHistory`), the notifications list function |
| SB2 | `app/mission/[id]/**` (case workspace and snapshots); `missions.ts` (`listMissionSnapshots`, `listTasks`), `complaints.ts` (`listComplaintsForMission`), `feedback.ts` (`listFeedbackForMission`), `agency.ts` (`listNotesForOwner` only) |
| SB3 | `applicant/[id]/sharing/**`, `applicant/[id]/insights/**`, `applicant/[id]/evidence/**`, `app/shared/[grantId]/**`; `sharing.ts` (`listAccessForApplicantDetailed`), insights reads, `agency.ts` (`listEvidenceRequestsForApplicant` only) |
| SB4 | `applicant/[id]/calendar/**`, `applicant/[id]/expiry/**`, `applicant/[id]/outputs/**`, `applicant/[id]/missions/prepare-again/**`, `apps/web/src/app/oauth/authorize/**`, `components/ai-access-choices.tsx`, `components/ai-file-choices.tsx`, `applicant/[id]/documents/**` (detail panel only) |
| SB5 | `app/agency/[orgId]/page.tsx` (dashboard), `cases/**`, `activity/**`, `clients/**`, `console-data.ts`; `agency.ts` (`listNotes`, `listVisibleMissionsForMember` paging, client invitations and requests lists) |
| SB6 | `app/admin/page.tsx` (overview), `admin/audit/**`, `admin/email/**`, `admin/complaints/**`, `admin/access/**`; `listRecentAuditEvents`, `listComplaintsForQualityReview`, `listFeedbackForQualityReview`, the pilot invitation list, the email delivery lists, the failed jobs list |
| SB7 | `admin/packs/**`, `admin/privacy/**`, `admin/ai/**`, `admin/document-protection/**`, `admin/organizations/page.tsx` (list only), `admin/members/**`; `organizations.ts` (`listAllOrganizations`), `legal-hold.ts` (`listLegalHolds`), the applicant directory read used by the privacy picker |
| SB8 | `apps/web/src/app/page.tsx` (landing), `apps/web/src/app/landing-c1.css`, `apps/web/src/app/trust/**`, `components/country-browser.tsx` (used by the traveller and agency country lists) |
| SB9 | `app/account/plan/**`, `agency/[orgId]/plan/**` (including invoices), `admin/plans/**`, `admin/billing/**`, `admin/organizations/[orgId]/**`; billing list functions |
| SB10 | `STATUS.md`, `COVERAGE-LEDGER.csv` summary rows, `docs/uiux/SCROLL-BUDGET.md` (new), the enforcement switch in `scroll-budget/support.ts` |

`agency.ts` is shared by SB2, SB3 and SB5, each touching different functions only. Edit only your named function, never reformat the file; git merges separate hunks cleanly. If a merge conflict appears in that file, keep both sides.

Frozen during Waves 0 and 1 (paid traveller plans T4 to T7): everything SB9 owns, `packages/services/src/billing*.ts`, `agency-invoices.ts`, `traveller-plan.ts`, payment files and ADR 0025 docs.

## 5. The automatic guard (built in SB0, used by everyone)

- `apps/web/e2e/scroll-budget/support.ts` exports `renderFixture(page, name, props)`, built on the existing fixture bundler in `apps/web/e2e/flat-ui-support.ts`, and `expectWithinBudget(page, { screens, viewport })`, which reads `document.documentElement.scrollHeight` at 390 by 844 and 1280 by 800 and also asserts no sideways scroll.
- Each package adds one file, `apps/web/e2e/scroll-budget/WP-SB<n>.spec.ts`, rendering its components with a worst-case data set (for example 500 history entries, 200 cases, 156 countries) and checking the budget plus the fixed panel height.
- Public pages (landing, trust) are measured on the built app in the same folder.
- CI: the PR browser job runs a fixed list of spec files. SB0 asks the owner to approve one line in `.github/workflows/pr-browser-checks.yml` that adds the `scroll-budget/` folder. Until that line is approved, the folder runs locally in `full-check.sh` and is reported as "not in CI".
- Enforcement: SB0 lands the checks in report mode (they print the measured heights and pass). Each Wave 1 package switches its own spec file to enforce. SB10 makes enforce the default for every file.

## 6. Packages

Size: S up to 2 hours, M 3 to 5 hours, L 6 to 10 hours of one session. Estimates only.

### SB0 Foundations (L, Wave 0)
- Log panel v2: extend `ActivityLog` without breaking its two users (`admin/audit/page.tsx:73`, `applicant/[id]/sharing/page.tsx:664`). Add optional `olderHref` and `totalLabel` props for a server-side Show Older Entries link; keep the client filters; add a Who filter where entries carry `who`.
- `show-more.tsx`: a server-rendered link control (`?show=<n>` or `?before=<cursor>`), with the visible count, an anchor to return focus, and polite announcement.
- `sticky-action-bar.tsx`: lifts the `.invitation-sticky` pattern (globals.css around line 9687) into a shared component; the invitation page keeps working.
- `collapsible-group.tsx`: a details and summary group with a count in the title and the first group open.
- `apps/web/src/lib/paging.ts` (parse and clamp `show`, `before`, `after`; build hrefs) and `packages/services/src/paging.ts` (`PageRequest`, `Page<T>`, cursor encode and decode on a time plus id key, limit clamp 1 to 100). Exported once from `packages/services/src/index.ts`.
- The guard in section 5, in report mode, plus the owner request for the CI line.
- Allowlist seed: the SB0 row of section 4, plus their test files, `apps/web/src/app/globals.css`, `docs/commercial-v1/known-issues.md`, `docs/upgrades/programme/COVERAGE-LEDGER.csv`, `docs/upgrades/programme/allowlists/WP-SB0.txt`.
- Acceptance: both existing log panel users unchanged in tests; each new component has page-level tests and axe checks; the guard proved to fail on a padded page.

### SB1 Traveller records and logs (M, Wave 1)
- Profile history (`history/page.tsx`): log panel v2, one entry per saved version, newest first, 50 per load; filter by section and by who changed it. Today every fact and every version renders with no limit.
- Case History (`memory/page.tsx`): latest case open, older cases collapsed; events in the log panel; limit 10 cases with Show More. `memory/compare`: changes capped at 10 with Show More.
- Consent history (`app/privacy/page.tsx` around line 171): log panel, limit 50, cursor.
- Notifications: 10 then Show More; Mark All Read; unread first. Today all unread render at once, capped at 50.
- Acceptance: history and Case History within 3 screens with 500 entries; consent and notifications in a fixed panel.

### SB2 Case workspace (M, Wave 1)
- `mission/[id]/page.tsx`: checklist requirements grouped and collapsed (first open group: what is missing); 5 newest snapshots plus a link to all; tasks, notes, outcomes, complaints and feedback each capped at 10 with Show More; the four header actions fold into one More menu on phones; a sticky next action.
- `snapshots/[snapshotId]`: requirement mapping, facts and documents each in a collapsible group with a count.
- Acceptance: Glance within 2 screens and Browse within 3 on a phone with a 60-requirement case.

### SB3 Sharing, insights, evidence, shared view (M, Wave 1)
- Sharing: 5 grants then Show More; grant details behind an expander. The access log already uses the panel: add the server cursor.
- Insights: each of the six cards collapsible, each list capped at 5 with a link to its own page.
- Evidence requests and the shared view (`shared/[grantId]`): 10 then Show More.
- Acceptance: sharing within 3 screens with 40 grants; insights within 3 with 100 documents.

### SB4 Traveller tasks and forms (M, Wave 1)
- Calendar: dates grouped by kind in collapsible groups with Select All; preview in a fixed panel (today up to 200 date rows and 100 preview rows).
- Expiry: rows capped at 10 at Browse.
- Outputs: three steps (choose, options, preview); field picker collapsed.
- Prepare again: groups collapsed; sticky Create Case bar.
- AI app consent (`oauth/authorize`): sticky Allow and Deny bar; case and file lists behind expanders.
- Documents: the selected-document panel moves into a sheet or its own sub-route so the paged list stays within budget.
- Acceptance: every page within 3 screens; the main action is always visible.

### SB5 Agency workspace (L, Wave 1)
- Cases (`cases/page.tsx`, `console-data.ts` `loadCases`): one case open at a time (`?case=`), the list paged at 15, notes capped at 10 with Show More, forms loaded only for the open case. Today every visible case loads its full panel and every note.
- Dashboard: top 10 cases plus View All; reassignment queue capped.
- Activity: log panel v2 (case as What, author as Who), cursor.
- Clients: status filter, 15 per page, forms behind expanders.
- Acceptance: cases within 3 screens with 200 cases, and the page reads data for one open case only (assert the service calls in the page test).

### SB6 Staff operations (L, Wave 1)
- Overview (`admin/page.tsx`): a two-screen overview; specialist cards in tabs or collapsible groups; failed jobs in a fixed panel.
- Audit: server cursor by sequence number on `listRecentAuditEvents` (today a silent cut at 300); add the Who filter.
- Email: failed and waiting lists in fixed panels.
- Complaints: status tabs with open first; fixed panel or 20 per page; forms behind expanders.
- Access: pending invitations only by default; history in a fixed panel; 25 per page.
- Acceptance: each page within 3 screens on a phone with 1,000 rows of data; each log in a fixed panel with a working cursor.

### SB7 Staff data and settings (M, Wave 1)
- Packs (`admin/packs/[packId]`): one version open, the rest collapsed; compact requirement rows; paging.
- Privacy: sections in tabs; holds and the purge list in fixed panels; replace the full applicant directory in the picker with search as you type (server limit 20).
- AI settings: each feature form collapsible; group by audience.
- Document protection: one tab per category.
- Organizations list: search, status filter, 25 per page, actions in a row menu (`listAllOrganizations` gains `options`).
- Members: page size 20, email search.

### SB8 Public pages and countries (M, Wave 1)
- Landing (`apps/web/src/app/page.tsx`, ten sections today): at most 6 phone screens; merge the problem, steps, capabilities and roadmap sections into one tabbed or collapsible block; no bento grid on phones; the first screen keeps the headline and main action (the existing test at `e2e/ux-public.spec.ts` line 96 must stay green).
- Trust: 12 routes then search and Show More.
- Country browser (`components/country-browser.tsx`): 12 shown, then Show More, keeping the search and chips. This fixes the traveller and agency country lists together.

### SB9 Billing surfaces (M, Wave 2, after paid traveller plans T5 and T6)
- Account plan, agency plan and invoices (compact rows, one open, 10 per page), admin plans (one row per plan), admin billing, organization detail (tabs for plan, invoices, overrides; each list capped at 10).
- Re-read ADR 0025 and the merged T5 and T6 code first; adopt their components, do not fork them.

### SB10 Integration and enforcement (S, Wave 3)
- Switch every `scroll-budget/` file to enforce; confirm the CI line is in place.
- One rendered measurement of every route the web tests render at 390 and 1280 (the CCD-7 width run method), recorded in `docs/uiux/SCROLL-BUDGET.md` with measured heights.
- STATUS.md, the coverage ledger summary, the known-issues chunk, and the owner report.

## 7. Session prompts (copy one per session)

Shared preamble: use the one in `docs/upgrades/programme/SESSION-PROMPTS.md` ("Shared preamble"), then add:

```text
Package: WP-SB<n> from docs/upgrades/programme/SCROLL-BUDGET-PLAN.md.
Read sections 1 to 4 and your package section of that file, nothing else first.
Your allowlist seed is your row in section 4 plus your tests, globals.css,
known-issues.md, COVERAGE-LEDGER.csv and your allowlist file.
Wave rule: Wave 1 packages start only after WP-SB0 is merged on main.
Do not merge. Open a draft PR and wait for the owner's merge word.
```

## 8. Done means

- Every page in the audit table meets section 1 at phone and desktop, proved by an enforced `scroll-budget/` check.
- No page loads an unbounded list; every log is in a fixed panel with filters and a working server cursor.
- Access checks unchanged (tenant isolation and permission suites green); no migrations; no new provider or dependency.
- Owner report after each merge per CLAUDE.md section 3.

## 9. Known limits of this plan

- Screen counts in the audit are estimates from the code, not measurements; SB0's guard and SB10's run replace them with measured heights.
- Signed-in pages were not rendered in the audit. Some pages may already be within budget at real data sizes; the package still adds the server limit.
- If a service needs an index for its cursor at real volume, the package records it as an owner decision; it does not add a migration.
