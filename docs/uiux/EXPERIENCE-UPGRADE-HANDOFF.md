# Experience upgrade: handoff record

Written 2026-10-13 for whoever continues this work next (Codex, Claude or a person). It says what was done, where, how and why, what is decided, what is waiting on the owner, and what to do next. It is a record of work in progress, not a product claim. For the product's verified state, read `docs/public-beta/CURRENT-STATE.md` first.

## Status at a glance (updated 2026-10-13, end of day)

| Phase | State |
| --- | --- |
| 0 Safety net | Merged (pull request 204, merge commit 9afdf3c). Production deployment READY, both smoke runs passed, live readiness "ready". |
| 1 Plain words | Merged in the same pull request. |
| 2 Loading, empty and error states | Approved by the owner on 2026-10-13 ("go ahead with phase 2 fully"). Built and verified locally; the pull request titled "Make loading, empty and error states specific to the page" carries it. Merge result is recorded in the known-issues log. |
| 3 to 8 | Planned, not built. |

CI on `main` for 9afdf3c (run 38406342710) had not finished when this was written; read its result in Actions before relying on it.

## 1. What this programme is

The owner asked for an extraordinary interface across the whole platform, safe to change because Codex built the previous phase and the owner alternates between tools. The goal in the owner's words: whatever is done should be done so well that people come back and bring others.

How it was approached:

1. A 17-seat read-only review of the whole interface (12 seats apply the published ideas of named experts; 5 are fictional composite profiles for the visa industry). The seats are lenses, not endorsements, and none of them has seen VisaStack.
2. A phased plan, ordered so that proof comes before change.
3. Phase 0 (safety net) and Phase 1 (plain words) are built. Phases 2 to 8 are planned, not built.

## 2. Rules from the owner (carry these forward)

- Presentation only. Do not change routes, server actions, permissions, consent, stored values, readiness rules or case states in an interface change.
- Preview first. For each screen or behaviour, show the owner a visual and describe the behaviour, then wait for a yes before building. Phase 1 was previewed and approved ("go").
- Stand-alone labels capitalise every word (Case Manager, Bank Statement). Terms inside a sentence stay lower-case. Buttons keep the app's sentence style. The owner has not yet said whether buttons should also be capitalised.
- No em dashes anywhere, including text people see. Use a hyphen, colon or full stop. Build the character from its code point if a file truly needs it.
- Plain language for people. No engineering words or tool names on screens. Bangla and all translation work is deferred.
- Small changes, one screen family at a time, each proven before and after.
- Never merge without every required check verified on the exact head commit, except where the owner has explicitly accepted a named gap. Never run a production database migration without the owner's go-ahead for that run. Never delete Neon branches without the owner confirming each one.
- Commits made by Claude are authored as `noreply@anthropic.com` (the session's stop hook requires it). A commit authored with an email Vercel cannot match to a team member makes Vercel mark the preview Blocked.

## 3. What has been done, where, how and why

| Step | Where | How | Why |
| --- | --- | --- | --- |
| Counter test (Phase 0) | `scripts/ui-ratchet.mjs`, `scripts/ui-ratchet.baseline.json`, `scripts/ui-ratchet.test.mjs`, wired into `pnpm run lint` and the root test script | Reads the code structure and counts inline style props, raw database codes printed as page text, and visible long dashes per file. A file may never exceed its recorded count. `--lower` rewrites the baseline when a count falls. | The review's top recommendation: numbers that can only go down stop the interface drifting while it is improved. |
| Page capture (Phase 0) | `apps/web/test/ui-capture-setup.ts`, registered in `apps/web/vitest.config.ts` | When `UI_BASELINE_DIR` is set, copies the markup the existing web tests already render to files. Inert otherwise. | Gives before and after pictures without signing in or touching a live service. |
| Screenshots and compare (Phase 0) | `scripts/ui-baseline/capture.mjs`, `scripts/ui-baseline/compare.mjs` | Renders each captured page with the real stylesheet at 1440 and 390 pixels wide, freezes animation, retakes until two shots match. `compare` counts differing pixels and treats a few pixels as the same (`UI_BASELINE_TOLERANCE`, default 300). | Same-machine before and after proof of exactly which screens a change touched. |
| Shared rules (Phase 0) | `docs/uiux/CHANGE-SAFETY.md` | Plain commands and rules. | One page that any tool follows. |
| Plain words (Phase 1) | `apps/web/src/lib/labels.ts`, `apps/web/src/lib/labels.test.ts`, `apps/web/src/components/exact-code.tsx`, 19 page edits | One label list typed against the stored values (a new value without a label fails the type check and the test). Pages call a label function at display time. The audit log keeps the exact code as small text next to the plain name. | Eight of 17 seats found raw codes such as PASSPORT or CASE_MANAGER shown to people. |
| Button wording (Phase 1) | `apps/web/src/app/app/applicant/[id]/ai-review.tsx` | Seven technical buttons renamed ("Run OCR" to "Read text from this scan"). Actions unchanged. | Seat 3 (plain language). |
| Long dashes (Phase 1) | seven page and form files | Replaced with colons, hyphens and full stops. | Owner's no-em-dash rule applies to visible text. The counter now guards it. |
| Test updates (Phase 1) | `apps/web/src/app/app/admin/privacy/page.test.tsx`, `apps/web/src/app/app/agency/[orgId]/team/page.test.tsx` | Expect the plain words and assert the raw code is absent. | The wording changed on purpose. |

| Loading shapes (Phase 2) | `apps/web/src/components/page-loading.tsx`, `apps/web/src/components/loading-slow-note.tsx`, eleven `loading.tsx` files, CSS in `apps/web/src/app/globals.css` | `PageLoading` takes a `shape` (`default`, `list`, `detail`, `dashboard`, `form`) and a label naming what is loading. A small client part adds "Still loading. You can keep this page open." after 8 seconds. Same accessibility behaviour as before (polite status, one hidden heading, shapes hidden from assistive technology). | Every signed-in page had the same grey shape and the single word "Loading". |
| Empty states (Phase 2) | `apps/web/src/components/ui.tsx` (`EmptyState`) and 25 pages | Every empty state shows an icon (a folder by default); 27 got fitting icons; two gained a real action ("How sharing works", "Add a document"). | An empty list should never read as a broken one. |
| Error screen (Phase 2) | `apps/web/src/app/app/error.tsx` (new), `apps/web/src/app/error.tsx` | A boundary inside the signed-in area so the menu should stay; honest promise (saved records are safe, anything being typed may need entering again); "Go to your overview" via a plain anchor to `/app`; help link and reference number. The top-level screen got the same honest wording and its three inline styles became classes. | The old promise ("nothing you had entered was lost") could be false, and "Back to home" led a signed-in person to the public page. |
| Failed export (Phase 2) | `apps/web/src/app/app/privacy/large-export-panel.tsx` | "Could not be made", what is safe, and a help link. | "Failed - request a new one" gave no reason or help. |

Evidence recorded: `docs/commercial-v1/known-issues.md` (two new chunks dated 2026-10-13), ledger row UX-01 (two update notes), and the pull request description.

## 4. How to check the work

```
pnpm run lint                                 # includes the counter, flat design check, route check
pnpm --filter @visastack/web run typecheck
cd apps/web && ./node_modules/.bin/vitest run  # 114 files, 1,292 tests at the time of writing
node --test scripts/check-flat-design.test.mjs scripts/check-route-navigation.test.mjs scripts/ui-ratchet.test.mjs
```

Before and after screenshots: see `docs/uiux/CHANGE-SAFETY.md`. At Phase 1 the compare of 354 screenshots (177 pages) listed 22 changed, all in the audit log, the founder privacy page and shared-with-me.

Guards were proven able to fail: adding an inline style or a raw role turned the counter red and named the file; deleting a label failed the type check and the label test.

## 5. What the review found (so the next phases can be built without repeating it)

Agreement across seats, with where to look:

| Finding | Seats | Look at |
| --- | --- | --- |
| Raw codes shown to people (done in Phase 1) | 8 | `lib/labels.ts` |
| Upload promises 20 MB; the host's request ceiling is about 4.5 MB; no phone camera option | 6 | `app/app/applicant/[id]/document-uploader.tsx` (default "20 MB"), `app/api/documents/upload/route.ts` (4 MB, used by no screen), `next.config.mjs` (25 MB server action limit). Failure at 5 to 20 MB is likely but not proven live. |
| Sharing page repeats scope three ways; ticking nothing shares everything | 5 | `sharing/page.tsx` l.167-202, `sharing/grant-form.tsx` l.160-186 |
| Consent wording is jargon and the privacy page is only a log | 5 | `app/app/privacy/page.tsx`, `client-invitations/accept/consent-gate.tsx` |
| Loading, empty and error screens are generic: one grey shape for every page, one message for every error, 4 of 31 empty states offer an action | 4 | `app/app/loading.tsx` (and three nested copies), `app/error.tsx`, `components/ui.tsx` EmptyState |
| One clear next step on home, applicant overview and case page | 3 | `app/app/page.tsx`, `applicant/[id]/page.tsx`, `mission/[id]/page.tsx` |
| Documents never say what was not checked | 3 | `components/document-wallet-browser.tsx` l.219 |
| AI confidence shown as a bare percentage; no "today to suggested" line | 3 | `applicant/[id]/ai-review.tsx` l.206-262 |
| Green "Ready" and a percentage ring read as a pass mark | 1 (practitioner) | `mission/[id]/page.tsx` l.72-100 and 739, `components/case-preparation-summary.tsx` |
| Phone More menu lacks dialog behaviour; status badges rely on colour | 2 | `app/app/app-nav.tsx`, `components/ui.tsx` StatusBadge |
| Evidence request form uses database words; no copy-ready message | 1 | `agency/[orgId]/request-evidence-form.tsx`, `invitation-link.tsx` |
| 861 inline style props in 107 files; 8 shared components only | 3 | counter baseline, `components/ui.tsx` |

Correction to the first review: it counted 4 loading files and 1 error file against 59 pages as if most pages had none. Those screens are inherited, so every signed-in page already has a loading screen and an error screen. The weakness is that they are all identical and generic, and the error screen's promise "nothing you had entered was lost" is stronger than can be proven. Phase 2 is scoped on that corrected reading.

## 6. Phases still to build

Each needs a visual preview approved by the owner before it is built, a characterization test for any page without one, and before and after screenshots.

| Phase | Theme | Notes |
| --- | --- | --- |
| 2 | Every state handled (built) | See section 3. Not done from the preview, on purpose: a Copy button for the error reference; converting the small in-panel "No ..." lines (for example "No open tasks.") into full empty states, because they are one-line notes that already say what will appear; more empty-state buttons, because elsewhere the form sits just below or only someone else can fill the list. Not yet seen: the menu staying on the error screen on a real signed-in page, and a test of the failed-export wording. |
| 3 | Shared parts | Spacing and text-size scales, then small parts (Stack, Text, Card, Button, Field, Notice). No page changes in this step. |
| 4 | Traveller core | One next-step card on home, overview and case page; upload with camera and honest size text; grouped case checklist ("Needs You", "Needs A Check", "Done"); profile save as you go; case creation with two fields first. |
| 5 | Trust screens | Sharing in plain sentences with three presets and a live "this person will see" line; consent shown as On and Off with a plain meaning; AI review with words first, "Today to Suggested" line and a "suggestion only" note; documents show checked and not checked; deletion with an in-page confirmation; re-login says why. |
| 6 | Agency | Plain evidence request, copy-ready message, quick filters (Mine, Overdue, Waiting On Traveller, Unassigned), deadline column, reassignment link. |
| 7 | Founder and public | Admin readiness rows in plain words with developer details behind a toggle; keep the "What works today" page honest. |
| 8 | Phone and accessibility | More menu as a proper dialog, visible text matching spoken names, status in words not colour, real-browser keyboard and contrast checks on signed-in screens. |

Left out on purpose (separate decisions): fixing large-file uploads in code, an agency spreadsheet case report and fee tracking, neutral sign-up wording when an email exists (touches account logic), any Bangla work, legal review of cross-border rules.

## 7. Decisions still waiting on the owner

1. Counting new events (first upload time, sharing completion, AI-review edits). Small and additive, but new behaviour. Not built.
2. Neutral "items on file" badge instead of a green "Ready", and renaming "Cover letters" to "Evidence summary for your file". Not built.
3. May the invitation page show who sent the link before sign-in? A privacy call.
4. Run the 3, 8 and 18 MB made-up-file upload test on staging so the size text can be made true.
5. Hide or keep the half-built Bangla language switch (about 50 strings exist; a switch is on the Account page).
6. Capitalise the renamed buttons too, or keep sentence style.
7. Agency spreadsheet report and fee tracking: add to the roadmap?
8. Resolved 2026-10-13: Phase 2 approved in full. The owner said the wording choices were unclear and asked for the correct wording, so Claude chose it: "Go to your overview" (not "Back to home"), "Could not be made" for a failed export, "How sharing works" on Shared with me.
9. Resolved: empty-state buttons only where a page already exists (two added).
10. Freeing one Neon preview branch so previews can build again (see section 9). The owner said on 2026-10-13 not to touch Neon branches; each candidate must be confirmed by the owner before anything is deleted.

## 8. Targets and baselines

Build-quality counts (measured): signed-in pages with a screenshot baseline 0 and 16 page tests for 59 pages; raw codes 19 to 0 (done); inline styles 861 (target under 100); loading and error screens: 1 generic shape and 1 generic message for every page (target: a shape per page family and wording per area); documents showing "checked / not checked" 0 percent.

Pilot funnel (made-up data, 23 Sep to 12 Oct 2026, directional only): 6 accounts created, 4 created an applicant, 2 uploaded a document, 1 created a case. A share like this cannot honestly be called 10x on 6 accounts; judge time to first upload and failed uploads on a few dozen fresh accounts. Usage counters for these do not exist yet (decision 1).

## 9. Known problems and gotchas

- **Branch limit confirmed from the database side (2026-10-14).** The Neon project is on the free plan with a limit of 10 branches and exactly 10 exist (main plus 9 previews). Neon records no failed operation, so the link to the preview failure is strong but still circumstantial. Production deployments do not create a branch and were unaffected: the merge of pull request 204 deployed normally.
- **Preview deployments fail to provision.** After the author fix, the Vercel preview for this branch ended with "Resource provisioning failed" about a second after starting, before any build. The likely cause is the Neon project's branch limit (10 branches at the time; the owner's rule is a maximum of 9). Not confirmed on the Neon side and not touched. The two required checks "No-secret Playwright checks" and "No-secret smoke check" only run after a successful preview, so they show as skipped.
- **Committer email.** See rule above. If a branch was pushed with an unmatched email, rewrite only your own unmerged commits and push with a lease.
- **Type rules versus lint.** TypeScript forbids dot access on `process.env` and Biome forbids literal bracket keys; read environment values through a function that takes the name (see `apps/web/test/ui-capture-setup.ts`).
- **Counter counts structure.** It counts 861 inline style props; the review's earlier 857 came from a text search.
- **Pages with no test of their own** (traveller overview, case page, expiry, history, evidence, cases list, help, privacy page and others) are not in the screenshot capture. Add a characterization test before the first edit to each, recording visible text and roles, not class names.
- **Signed-in screens on a real sign-in** are still unverified; the isolated staging project is the place for that.
- Pull requests 77 and 177 are old open drafts that are not part of this work.

## 10. Where the owner-facing material lives

The owner has private pages from this session: the plan and mockups, the Phase 1 preview and the Phase 1 result. They are not stored in the repository. Everything needed to continue is in this file, `CHANGE-SAFETY.md`, the known-issues chunks and the pull request description.

## 11. Next steps, in order

1. Confirm the Phase 2 pull request merged and production is healthy; read the CI result on `main` and the live readiness page.
2. Look at the error screen on a real signed-in page (it should keep the menu) and note the result in the known-issues log.
3. Take the open decisions in section 7 to the owner: usage counters, "items on file" instead of a green "Ready", button capitalisation, the Bangla switch, the upload test on staging, the agency backlog items, and the Neon branch (the owner asked to leave Neon alone for now).
4. Phase 3 (shared parts: spacing and text-size scales, then small shared parts) is next. Show the owner a visual and the behaviour first.
5. After any merge, record the result in `docs/commercial-v1/known-issues.md` and refresh the status table above.

## 12. Session log, 2026-10-13 (what happened, in order, so it can be traced)

Times are UTC. "Owner" is the founder. Claude did all of this in one session; nothing was done by other tools. Everything below is also visible in the pull requests and commits named.

1. **Access check.** Confirmed the repository is the only one in scope (`sadatnitex/visastack`) and the GitHub account is `sadatnitex` (the founder, email `sadat.nitex@gmail.com`).
2. **Whole-repository scan.** Read the code, not just the docs: about 700 TypeScript files, 81 database tables, 86 migrations, about 160 services, 17 job endpoints. Reality notes worth keeping: the live app database is `visastackdev` inside the Neon project `NeonSadat` (`long-sun-23747504`); that project's default database `neondb` holds an older, unrelated set of about 100 tables that this repository never touches; the live database had 1 test requirement pack ("UK Visitor1", 2 requirements), 6 accounts, 6 applicants, 5 documents, 1 case, 3 agency organizations (none active) and 1 active AI setting (Gemini). Only three document types are auto-recognised (passport, bank statement, employment certificate). The owner received a Word summary.
3. **Plan and council.** The owner asked for a platform-wide interface upgrade, then for a council of named experts. 17 read-only review seats ran (12 apply the published ideas of named experts; 5 are fictional composite profiles). The owner overrode the "no subagents" rule for the council only; that override ended with it. Findings are in section 5. The owner's published pages (private to them): the plan and mockups, the Phase 1 preview and result, the Phase 2 preview and result.
4. **Owner rules set during the session.** Preview every change visually and describe its behaviour before building it; a stand-alone label capitalises every word (Case Manager) but a term inside a sentence does not; no long dashes anywhere; plain language; do nothing with Neon branches; keep records so Codex can trace the work.
5. **Phase 0, safety net.** Counter test, page capture hook, screenshot capture and compare tools, shared rules page (section 3). Two problems found and fixed on the way: screenshots were not repeatable until animation was frozen and each shot retaken until two matched; byte comparison was too strict, so compare now counts differing pixels with a tolerance.
6. **Commit identity problem (Claude's mistake).** Claude authored the first commit with `sadat@nitex.com`, an address that is not the GitHub account's email. Vercel marked the preview Blocked because it could not match the author to a team member. Fixed by re-authoring Claude's own unmerged commits as `Claude <noreply@anthropic.com>` and force-pushing that one draft branch; Vercel then accepted the author.
7. **Preview deployments fail to provision.** After the fix, every preview failed with "Resource provisioning failed" before building. The Neon project is on the free plan with a limit of 10 branches and has exactly 10. Nothing was deleted. Production deployments are unaffected. The two required "No-secret" checks are skipped on any branch whose preview fails; the owner accepted merging on that basis.
8. **Phase 1, plain words.** 19 raw-code places now show labels from `apps/web/src/lib/labels.ts`; seven buttons renamed; visible long dashes removed; audit log shows plain name plus exact code (section 3). Pull request 204, merged as 9afdf3c. Production deployed READY on both addresses, both smoke runs passed, live readiness "ready".
9. **Records PR (205).** Corrected an earlier mistake: the first review said most pages lacked loading and error screens, but they are inherited, so every signed-in page has both; the real weakness was that they are generic. Also corrected the inline style count (861 from reading the code, not 857 from a text search).
10. **Phase 2, states.** Previewed, approved ("go ahead with phase 2 fully"), built and verified locally (section 3). Verification: 115 web test files and 1,298 tests, lint, type check, route check, Node tests, the Next.js production build, and a 384-screenshot compare.
11. **Scheduled self check-ins** were used instead of polling CI. They are not stored in the repository and have no standing effect.

Left open at the end of the day: the decisions in section 7, the Neon branch limit, viewing the error screen on a real signed-in page, and signed-in screens on a real sign-in.
