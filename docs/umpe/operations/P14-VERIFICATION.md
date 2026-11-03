# P14 verification report: UMPE journeys J1 to J8

Branch `umpe/p14-verification` from `umpe/int-w5` 1423f554 (main plus G2 and G4). Verifier: no product code changed. Date: 3 November 2026.

## What was proven, in plain words
Every journey in the audit (section D) was driven end to end through the real services on a migrated test database with made-up people and files, and stand-ins for AI, email, file storage and the clock. 65 journey tests in 8 files plus 4 web tests for the 80-file import pass, and none of them found a product defect. The signed-out collection pages were checked in a real browser at 390, 768 and 1280 pixels, with the request switch both on and off.

What was NOT proven: anything that needs the live site. That includes real sign-in, real email delivery, real AI provider calls, the real malware scanner, the scheduler actually firing on the live site, measured speed and AI cost, and the exact deployed commit. Those stay owner and deployment items (below).

## Proof table per journey

| Journey | What the user sees (proven) | Test files | Role and tenant proof | Not verified, and why |
|---|---|---|---|---|
| J1 Individual intake | 80 files including a nested folder each get their own settled line (file 21 and file 80 included), at most 2 in flight; zip, exe, empty and oversize files refused with a plain reason, never sent; clear files filed, ambiguous ones left unresolved; duplicate, new period, renewed passport and corrected scan proposed, none applied; proposals point to their document and never become approved facts on their own; a differing value stays under review as a conflict | `packages/services/src/umpe-journeys/j1-individual-intake.test.ts` (10), `apps/web/src/lib/umpe-journey-j1-import-queue.test.ts` (4) | A stranger cannot approve a proposal; a family file matching one person is never filed under another person or another account; a protected kind gets only a redacted excerpt and is never read in detail; an unknown kind is treated as protected | The real upload route, scanner and screens; real AI recognition quality (a counting stand-in is used) |
| J2 Trip and family | Country, purpose, residence and dates pick the newest fitting pack version and never another purpose, residence or a date outside the window; three people get three cases with their own requirement sets; either any-of alternative satisfies its group; exact versions are pinned; the shared booking shows only after an allowance; recommended evidence never blocks; an unknown condition stays Unverified | `j2-trip-and-family.test.ts` (11) | Another person's version cannot be pinned; Exclude is refused on a blocking item and the gap stays visible; an outside adult and a child without a guardian confirmation cannot be added | The trip screens; age from date of birth (encrypted, P5 gap) |
| J3 Ongoing update | A corrected scan, a newer statement, an expiring passport and a published rule revision each reach only the active affected case, never an unrelated or cancelled one; one note per change; repeating the check adds nothing; the handed-off snapshot rows stay byte-identical | `j3-ongoing-update.test.ts` (7) | The database refuses edits to a handoff; a second handoff is refused | A resolved fact conflict changing a package: no service links a conflict decision to a package change, so this step is not covered (gap, not faked). Email delivery of the note |
| J4 Agency to existing account | Agency picks route, destination, purpose and date, edits and issues an immutable revision; the neutral link answer shows only an ACTIVE agency's brand and the same answer for unknown, expired and revoked links; the invited account shares one exact version and a later upload never reaches the agency; correction requested and answer replaced; agency reads audited with counts and kinds only; the old client invitation still works | `j4-agency-request-account.test.ts` (9) | Forwarded and wrong-email links refused exactly like unknown ones; revoked link and closed request refused; no grant created; another agency's lookup looks like a missing record; a requester-only member cannot read answers | Real Neon Auth sign-in and the return to the request after sign-in; real email delivery |
| J5 Agency to guest | Six-digit code by email (stand-in outbox) proves the address; uploads over two sittings with a second code; files matched against the exact issued revision and a wrong match corrected; retention chosen from 3/7/15/30/60/90/180 days with none preselected; explicit submit; agency sees receipt, review history and asks for a correction; the guest sees the note | `j5-agency-request-guest.test.ts` (10) | A forwarded address alone shows no draft; another agency and another request denied like missing; the 12-hour session cap holds; revoked link and closed request refused; no account, traveller or document row created; a later account with the same email adopts nothing; submission rows refuse edits | Real email delivery, the phone browser flow with a live issued request |
| J6 Official sources | The weekly run (one per Dhaka week, repeat runs do nothing) turns changed pages into candidates for review; blocked, PDF and unavailable pages are never counted as checked; fetch time, reviewer action and "last verified by a person" stay separate; pack rows stay byte-identical; only a second person can approve; publishing flags the live case without touching issued agency revisions, handoffs or the case | `j6-source-maintenance.test.ts` (6) | The author cannot approve their own version; no code path outside `packs.ts` creates, approves or publishes | Real official sites; the scheduler firing on the live site. Note: `apps/web/vercel.json` runs the source job daily (`0 3 * * *`), not Saturday only; the service itself limits real work to one run per Dhaka week, so the outcome matches ADR 0026 D6 |
| J7 Field intelligence | Two submissions stay two attempts with their own versions and outcomes; missing outcomes stay Unknown even after the case closes; a refusal then an approval stay separate | `j7-field-intelligence.test.ts` (6) | Self-reported is never shown as verified (a verified decision is refused); guest receipts count as agency submissions only; a small group is hidden; the report has no prediction fields and nothing personal | Real cohort sizes (made-up data only) |
| J8 Role, safety, preservation | AI off (kill switch or consent off): no provider call, manual profile edits and document kinds still work; the frozen pack checksum still matches; account deletion removes trips, handoffs and attempts and queues held files for erasure; unscanned and quarantined files are never served, a structural check reports "not virus scanned" | `j8-role-safety-preservation.test.ts` (6) | Cross-agency denial for requests, answers and guest files; cross-person denial for trips, packages and attempts; each denial looks like a missing record | Signed-in desktop and phone end-to-end tests with real providers on the deployed commit; the real scanner configuration; billing and restore on the live site |

Signed-out browser checks: `apps/web/e2e/umpe-collect.spec.ts` (6 tests). Every made-up, malformed, forwarded or missing token gets the same answer and never stays in the address; a closed link clears the desk cookie; the landing page is neutral, unindexed, fits 390, 768 and 1280 pixels and passes axe; `/collect/account` sends every signed-out visitor to the same sign-in page, cookie or not. Run on a local production build: switch on 6 passed; switch off 5 passed and 1 skipped (cookie check applies only when on). The guest code step itself cannot be shown in a browser without an issued request and a database; it is covered by `apps/web/src/app/collect/collect.test.tsx` and J5.

Guards proven red during P14 (each restored from a cp backup, then green): the link recipient check in `access/collection-response-access.ts` (J4 forwarded-link test failed); the blocking-item rule in `recordPackageChoice` (J2 Exclude test failed).

## Ledger (87 rows), final counts

| Status | Count | Rows |
|---|---|---|
| TESTED | 81 | All others, each with a named passing test; F01, F04, I01, I05, I06, I12, I17, R06, A01, A02, S04, U05, U06 promoted from retained behaviour after naming the test |
| IMPLEMENTED | 3 | U02 (phone task completion with a live request not browser-tested), U03 (calm design is a judgement; no design review tool here), U04 (performance never measured on a deployment) |
| BLOCKED | 2 | F05, F06 (owner: real-data activation and live acceptance) |
| CONTENT | 1 | R10 (editorial route coverage) |

Corrected on the way: rows R02, R05, R08, R12, R18, R22 and S08 named a test file that does not exist (`pack-rule-details.test.ts`); they now name `umpe-g2-rules.test.ts`, which tests `pack-rule-details.ts`.

## Owner actions still needed
1. Real applicant data: permission to process real passports and personal documents (F05, F06); nothing here switches it on.
2. Malware scanning: confirm the production scanner is configured and returns real verdicts; tests prove only that an unscanned or structural result is never shown as clean.
3. AI provider and protection: whether unknown kinds stay protected (today the classifier recognises only redacted excerpts and never reads them in detail); provider, budget and consent settings on production.
4. Payments: no payment change in UMPE; any charging stays an owner decision (ADR 0020).
5. Database: run the pending UMPE migrations in merge order, each with its own "migrate NNNN" word.
6. Live acceptance: a seeded test agency, guest and traveller on the deployed commit to run J4 and J5 in a real browser with real email delivery.
7. Official content: reviewed checklists for each route before calling it supported (R10).
8. Decide whether the source job should be Saturday only in `vercel.json` or stay daily with the weekly limit in the service.

## Release verdict
- HEAD / deploy SHA: branch head as handed back / not deployed from this branch.
- Integrated journeys: J1 to J8 proven below the browser with direct test files above; signed-out desk proven in a browser.
- Actual runtime (auth, email, scanner, AI provider, source monitor on the live site): not verified in this session.
- Measured cost and performance: unmeasured.
- **Verdict: FEATURE COMPLETE IN TEST.** It is not "deployed and verified" and not "ready for real data". It reaches those only after the owner actions above and a live run on the exact deployed commit.
