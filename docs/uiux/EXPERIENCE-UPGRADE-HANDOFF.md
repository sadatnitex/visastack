# Experience upgrade: handoff record

Written 2026-10-13 for whoever continues this work next (Codex, Claude or a person). It says what was done, where, how and why, what is decided, what is waiting on the owner, and what to do next. It is a record of work in progress, not a product claim. For the product's verified state, read `docs/public-beta/CURRENT-STATE.md` first.

## Status at a glance (updated 2026-10-13, end of day)

| Phase | State |
| --- | --- |
| 0 Safety net | Merged (pull request 204, merge commit 9afdf3c). Production deployment READY, both smoke runs passed, live readiness "ready". |
| 1 Plain words | Merged in the same pull request. |
| 2 Loading, empty and error states | Merged (pull request 206, merge commit 15bf62d). Production deployment READY and the Deploy Smoke run passed. The live readiness page could not be read from the build session (a tool error, not a site error), so that one check is unconfirmed. |
| 3 Shared sizes and spaces | Approved 2026-10-13. Built and proven by an unchanged screenshot compare (386 of 386 match). Shipped as its own pull request. |
| 4 Traveller first hour | Approved 2026-10-13 with the camera button and no size number. Built; shipped with phases 5 to 8. |
| 5 Trust screens | Approved. Sharing card, explicit scope choice, in-page revoke question and the consent On/Off screen with plain names built. |
| 6 Agency desk | Approved. Quick views and deadline column built. |
| 7 Founder overview | Approved. Provider rows now lead with a status word and a plain sentence. |
| 8 Phone and access | Approved. Mostly checking: the code already met contrast, tap height and spoken-name rules, so a guard test was added. The real-browser keyboard pass on signed-in screens still needs a staging test sign-in. |

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

| Shared text and spacing (Phase 3) | `apps/web/src/app/globals.css` (text scale names, `u-` classes at the end), 80 page files | Six text sizes named as tokens. 14 `u-` classes each carry exactly the value pages used to write inline (the number in a name is the value in hundredths of a rem). 358 inline style props now use them. `!important` keeps the precedence an inline style had. Counter 857 to 500. Values off the scale (0.8, 0.9, 1.25 rem) keep their number in the class name until a separately previewed snap step (3c, not built). | Pages wrote spacing and sizes by hand 857 times. |
| Case form (Phase 4b) | `applicant/[id]/missions/create-mission-form.tsx` | Asks "What is this case for?" and "Where are you going?" first; the other six boxes sit in a fold-out. Every field name is unchanged. The end-to-end test label was updated. | Eight boxes up front, one required. |
| Case checklist (Phase 4c) | `mission/[id]/page.tsx`, `lib/requirement-groups.ts`, snapshot page | The seven outcomes are shown under Needs You, Needs A Check and Done, with plain badge words (Missing, Two Values, Out Of Date, To Confirm, On File, Optional, Not Applicable). The summary counts box above still uses its older words. | A single list sorted by seven technical outcomes. |
| Upload (Phase 4a) | `applicant/[id]/document-uploader.tsx` | A Take a photo button opens the phone camera through the same file field. The page no longer prints a size limit; the configured value is still passed in and is kept for when a live upload test proves the real number. | The host may refuse large files before the app sees them. |
| Evidence request form | `agency/[orgId]/request-evidence-form.tsx` (pull request 207) | Asks what is needed, then lists named profile details or documents; Other document adds a name box. Values sent are unchanged codes. | The form showed "Field key / document type" and passport_number. |
| Sharing (Phase 5) | `applicant/[id]/sharing/page.tsx`, `grant-form.tsx`, `grant-op-buttons.tsx` | One sentence per grant; Everything or Only the parts I choose for the profile and for documents (choosing only some with nothing chosen is refused); the revoke question is inside the page. View metadata reads See document details. | "Leave all unchecked to share every category", repeated Can and Scope lines, and a browser pop-up. |
| Agency list (Phase 6) | `agency/[orgId]/page.tsx` | Quick views Mine, Overdue, Waiting On Traveller, Unassigned (a `quick` setting in the address) with counts, and a Deadline column. | Search and four filters existed; no one-tap views. |
| Consent On and Off (Phase 5c) | `lib/labels.ts` (`CONSENT_PLAIN`, `consentName`), `app/app/page.tsx`, `consent-button.tsx`, `client-invitations/accept/*`, `privacy/page.tsx`, and the pages that tell a person to turn a consent on | English screens show the plain name, a one-line meaning, an On or Off word and Turn on or Turn off buttons. Bangla keeps the old names and buttons. The values sent to the server are unchanged. End-to-end test names updated. | Internal names such as Core processing and Grant buttons. |
| Account deletion question (Phase 5) | `privacy/deletion-panel.tsx` | Asking before scheduling deletion happens inside the page (Yes, schedule deletion or Keep my account). The end-to-end test was updated. | A browser pop-up. |
| Founder rows (Phase 7) | `lib/provider-operations.ts`, `admin/page.tsx` | Each row has a status word and one sentence; the reading, source and caveat sit under Show technical detail. Set Up is never shown as proven. | Raw readings read by someone who knows the system. |
| Access guards (Phase 8) | `lib/a11y-guards.test.ts` | Tests for text contrast, the 44 pixel button height and button spoken names. | Nothing prevented a later change from breaking them. |

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
| 3 | Shared parts (3a and 3b built) | See section 3. 3c (snap off-scale sizes onto the scale) is not built and needs its own preview. Small parts such as Stack and Notice are not built. |
| 4 | Traveller core (built) | See section 3. Next step cards and per-field saving already existed and were not rebuilt. The case summary counts box still uses older words. |
| 5 | Trust screens (partly built) | Built: sharing and the in-page revoke question. Consent shown as On and Off with plain names is built for English (Bangla keeps its existing words). Not built: AI review wording, documents showing checked and not checked, the founder tools, agency member toggle, case buttons and contributor requests still use browser pop-ups (about 15 places; the sharing revoke and account deletion questions are now inside the page), a re-login note. The sharing form already had a live access summary and a review step, which were kept. |
| 6 | Agency (built) | See section 3. A copy-ready message for an evidence request is not built. |
| 7 | Founder and public (provider rows built) | The other founder panels (signals, commercial gates) were not reworded. The public "What works today" page was not touched. |
| 8 | Phone and accessibility (guards built) | The More menu already closes on Escape, returns focus and closes on an outside tap. Contrast, tap height and spoken names pass and are now guarded. Still open: a real-browser keyboard pass on signed-in screens. |

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
12. Resolved 2026-10-13: approve phases 3 to 8; ship the camera button without a size number; add Other document to the evidence form; later add a big shared list of documents, fields and categories (the form reads the shared document table in `lib/labels.ts` and the profile field list, so additions appear without form changes).
13. Resolved 2026-10-13 (owner's answers to the adviser brief): plain consent names approved; the travellers are Bangladeshi, so wording is for them; one On/Off switch that can be changed any time is enough; AI consents do not name the provider or cross-border transfer for now; no new separation of marketing and sharing from the rest (they already sit in the same list); the admin approves future wording changes. These are the owner's decisions, not a lawyer's sign-off, and nothing here is verified against Bangladeshi law.
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

1. Confirm the pull requests for phases 3 to 8 merged and production is healthy; read the CI result on `main` and the live readiness page.
2. Bangla consent names follow the English ones when the Bangla work resumes (deferred). The meaning lines should be read by someone who knows Bangladeshi data rules.
3. Phase 3c (snap off-scale sizes) needs its own preview.
4. Run the live upload size test (3, 8 and 18 MB made-up files) so the size line can come back.
5. A staging test sign-in is needed for the real-browser keyboard pass (Phase 8) and to see signed-in screens.
6. Not built from the approved list: the AI review wording, documents showing checked and not checked, account deletion in-page confirmation, a copy-ready evidence message, and the Phase 7 panels beyond provider rows.
7. After any merge, record the result in `docs/commercial-v1/known-issues.md` and refresh the status table.

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

13. **Evening, 2026-10-13.** Pull request 206 (Phase 2) merged as 15bf62d; production deployed and the Deploy Smoke run passed. The owner reported the evidence form still showed passport_number; pull request 207 replaced it with named choices, then added Other document. The owner approved phases 3 to 8 and asked for the camera button without a size number and, if possible, the adviser's input on consent wording. Phase 3 was proven with an unchanged screenshot compare (386 of 386). Phases 4 to 8 were built with tests; the compare against Phase 3 changed only the screens meant to change (admin overview, agency list, sharing page) and added the new case form. Not in the screenshot set because no page test renders them: the case page, upload page and sharing form.
