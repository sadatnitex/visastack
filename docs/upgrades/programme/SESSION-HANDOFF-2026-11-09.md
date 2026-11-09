# Session handoff, 9 November 2026

Supersedes `SESSION-HANDOFF-2026-11-01.md` for current state (older handoffs stay as history). Read `CLAUDE.md`, then `docs/SESSION-START.md`, then this file, then **only the sections of the plan your package needs** (`docs/uiux/ccd/CASE-PAGE-AND-LIST-PATTERN-PLAN-2026-11-09.md`). Main was `64120c1b` (#473) when this was written. Facts below were checked on main, on GitHub and in the production database on 9 Nov 2026 unless they say "not verified".

**Token discipline (owner, 9 Nov 2026: the previous session cost far too much).** Read narrowly (grep, line ranges). No polling, no narration. One full local check per package, started once in the background with `scripts/agent/full-check.sh <worktree> <logdir>` and read only its `summary.txt`. At most two helpers at a time with complete briefs. One package per session. Do not re-derive anything this file already states.

## 1. What is live (all on main, deployed, checked)

| PR | What | Notes |
|---|---|---|
| #464 to #468 | Case rail type scale and tone; tap feedback and the decision pack docs; design language on more screens; docs for decisions 11 to 13; owner decisions applied (desktop "auto" depth is Glance, official page link, landing proof line, D1 exact copies approved, partial restore drill) | `docs/SESSION-START.md` section 6 holds the decisions |
| #469 | Starter country lists: 33 countries (485 sheet lines), Tourist base plus Business and Medical lists where the sheet has extras, loaded and updated by a platform admin in Pack Studio (Starter Country Lists), downloadable and re-loadable as a sheet | `docs/operations/starter-country-lists.md` |
| #470 | Make It Our Own: an agency owner or admin copies a shared list into their own, edits it as a draft and publishes the next version. New gate `AgencyChecklistScope` (`packages/services/src/access/agency-checklist-scope.ts`), `agency-checklists.ts`, pages under `app/app/agency/[orgId]/checklists` | Only that agency's cases offer the copy ("your agency's list") |
| #471 | Fix: the Starter Country Lists page failed on the first button press because a `"use server"` file exported an object. New guard `apps/web/src/lib/use-server-exports.test.ts` | Found from the production runtime logs |
| #472 | Edit Wording: a traveller rewords an item on their own case (display only, original always shown, open cases only, 400 characters, 100 changes per case, owner-only). Migration 0133, table `case_checklist_edits` | `packages/services/src/case-checklist-edits.ts`; guard `case-checklist-edits-boundary.test.ts` lists the only files allowed to name the table |
| #473 | The traveller's own passport is always Required on every starter list (26 lines in 26 lists changed), plus a fix to a held-file reminder test that had a fixed date and began failing on 9 Nov | `isOwnPassportLine` in `packages/core/src/starter-checklists/doc-type-rules.ts` |

**Production database** (read-only checks, 9 Nov 2026): Neon project NeonSadat `long-sun-23747504`, default branch `main`. **The application database is `visastackdev`, not `neondb`** (`neondb` holds a different, older schema; always pass `database_name: visastackdev`). 132 migrations applied, latest 0133 (run 42595915116, from main, on the owner's word "migrate 0133"). **The next free migration number is 0134.** 53 starter lists published, 28 of them at version 2 or later (after the owner reloaded the lists), no open drafts; the UK Tourist and Business lists and the Vietnam list have the passport Required. Branches in the project: `main`, `preview/public-beta/r2-encrypted-recovery`, `drill/2026-11-06-restore-check` (deleting the drill branch needs the owner's word).
**Live site:** `https://vs.obsidianglobal.studio` (fallback `https://visastack-five.vercel.app`); Vercel project `prj_RZcDRy1odwehHuDqsiGwvVGC0epe`, team `team_YDtSBrhGH5u4NwrHUCCddXwS`. `/api/health/ready` returns `ready` in `controlled_pilot`. The Vercel connection now works: `get_runtime_logs` (Hobby keeps one hour only) and `web_fetch_vercel_url` (a signed-in page answers with the sign-in page, so it only proves the route exists). Direct `curl` to the live site is blocked from the machine.

## 2. Owner decisions in force (new since 1 Nov, newest first; the full list is `docs/SESSION-START.md` section 6)

- 9 Nov: **"passport is required always"** (built, #473).
- 9 Nov: **"Recommended" on every redesign decision** and on the four earlier questions. The thirteen decisions are written out in section 1 of the plan; read them before building.
- 9 Nov: "migrate 0133" (done). A migration word is valid only for that number; if the next free number changes, ask again.
- 9 Nov: the case page and every list screen must feel calm and familiar "like Drive and Dropbox", and be **consistent everywhere** (one shared pattern).
- 6 Nov: the desktop "auto" depth is Glance (ADR 0023 addendum); no screen opens past 30 words of explanation.
- Still deferred by the owner: **Bangla and all translation**, and **staff sign-in protection (MFA)**. The final release-candidate PR is never merged without the owner's word after they read the final report.
- Reporting: after every merge and deployment, a plain-language table (Area, What changed, What you will see, Who notices), then Checked live, Not live yet, Not yet checked, Needs you, then what was done and one next step. No em dashes anywhere.

## 3. Open owner items (none block building)

Withdraw the old test checklist "Visitor1" in Pack Studio; name the first one or two routes and one reviewer who is not the author (`docs/roadmap/ROUTE-REVIEWER-BRIEF.md`); send the counsel pack and give the date; make the offline copy of the master key and open an AWS account for the key service; confirm deleting the drill branch; try Edit Wording on one real case and report what they see (not verified live: nobody has seen the control on production).

## 4. The next work: the case page and one list pattern

The owner approved a redesign. **Start with package 0, then package 1** (sizes and contents in section 9 of the plan). Key facts a new session must not get wrong (all in the plan, section 2, with file and line):

- The case page (`apps/web/src/app/app/mission/[id]/page.tsx`) is shown **only to the case owner**. The stage tracker, Advance the Case, Snapshots and Contributors are the traveller's own functions with agency words; hide them only by `selfReviewed`, never remove them.
- "Done 17" counts optional items with nothing uploaded (`lib/requirement-groups.ts`); the Trip Package panel repeats every item again (named by file type: "Other" twice, "Nid", "Noc") and the Select Evidence panel repeats them a third time; "Requested by Your Agency" comes from `package-panel.tsx` because the starter lists are stamped `AGENCY_ADDED` (fix in the display only; never touch `starter-packs.ts` or a published version); two time-zone lists of about 420 options are built on every page load; the scroll-budget test never measured this because its worst case had no Trip Package and only Glance.
- Readiness, access gates, published packs, server action names and form field names do not change. No database change anywhere.
- Documents already has the target pattern (list, side panel, full screen on a phone): extract it into `components/list-pattern/`, do not invent a new one.
- A mockup to open in a browser: `docs/uiux/ccd/mockups/case-page-proposal-2026-11-09.html` (laptop and phone widths). Build to the approved icon rule (status glyph on rows, file-kind icon only on Documents), not to the mockup's icons.

## 5. Known gaps and backlog

- Starter list content: the 485 lines' document types were read by rules and have not been reviewed by a person. Two kinds of line typed as a passport stay Required under the ordinary rule because the sheet says "All applicants" (a host's passport "if invited by an individual", and passport photograph lines): a content pass is the right fix.
- Edit Wording phases not built: the agency seeing the traveller's wording (separate, deliberate read), and "My Own Items" (a never-counted personal list; needs no new migration). Hiding a required item is never allowed.
- A change the platform makes to a shared list does not reach an agency's copy, by design.
- Live acceptance of every converted screen is "built and tested, not seen live" (`docs/uiux/ccd/PARITY-LEDGER.md`); seven authenticated screens await verified isolated fixtures.

## 6. Pitfalls learned (each cost a failed run)

1. A file that starts with `"use server"` may export only async functions (types are fine). Tests load it as a normal module and miss this; the live server does not. Guard: `lib/use-server-exports.test.ts`.
2. The supply-chain static scan (`node scripts/supply-chain/scan.mjs --no-skips`, also in CI) reads a `RegExp.exec(` call as a shell call. Use `String.search`. Run the scan locally; the local lint does not include it.
3. Biome rewrites ` ` escapes inside regex literals into raw characters, which breaks the regex; use character codes. Biome also rejects exports from test files, unused variables, and `obj.prop` on index signatures (destructure instead).
4. Tests with a fixed calendar date become time bombs: one began failing on 9 Nov 2026 at 10:00 UTC. Use dates relative to the real clock.
5. The local `main` branch can be many commits behind: always `git fetch` and branch from `origin/main`. A force push is blocked by the permission classifier; after a squash merge the remote branch is deleted, so recreate the branch from `origin/main` and push normally (if the remote branch still exists, `git merge -s ours origin/<branch>` then a plain push).
6. A background command's "completed" notice may be for the launcher only (when it ended with `&`). Result files in a scratch folder can be left over from an earlier run: check the finish marker and the file times before trusting a number.
7. The session's stop hook nags about unpushed commits at every turn; push only after the full local check is clean.
8. The system subscribes a new PR to its events automatically and again after the first notice: unsubscribe each time (`mcp__claude-code-remote__unsubscribe_pr_activity`).
9. Record ids belong in the query string, not in a folder name (`lib/not-found-status.test.ts`). Every new client form must be registered in `lib/a11y-forms.test.tsx` and use `useId` for ids; every new page must be in `lib/experience-parity.ts`.
10. The proof for a case is `requireAccess(db, accountPrincipal(id), 'MANAGE' | 'VIEW_METADATA', { missionId }, { purpose: 'self' })`; with `{ applicantId }` it names the person, not the case.
11. The GitHub merge tool once timed out; check `gh api repos/sadatnitex/visastack/pulls/N --jq .merged` before retrying. `gh` works for runs and reads; mark a draft ready with `gh api -X POST repos/sadatnitex/visastack/pulls/N/ccr/ready_for_review`. Load the GitHub PR tools with ToolSearch (`select:mcp__github__create_pull_request,mcp__github__merge_pull_request`).
12. Use `NODE_OPTIONS=--max-old-space-size=8192` for `tsc` and `vitest`. Use absolute paths; a stray `cd ..` has caused wrong-folder runs several times.
13. The migration workflow is `gh workflow run db-migrate.yml --ref main -f confirm=migrate`, only after the owner's word for that specific number. Before running, confirm only that one migration is pending (compare the journal with `drizzle.__drizzle_migrations` in `visastackdev`), and afterwards verify the result in the database.

## 7. How a package ships here

Plan agent for anything large; `/code-review high` before every push (`max` for access, documents, sharing, payments, deletion or anything hard to reverse), `/security-review` for anything touching access or personal data, design review for screen changes. Prove new guards can fail (break the real code, watch the test go red, restore from a backup copy). Draft PR with the template headings, unsubscribe, wait with `scripts/agent/wait-ci.sh <full head sha>` in the background, mark ready, squash-merge with the expected head SHA, then `scripts/agent/wait-deploy.sh <merge sha>`, check `/api/health/ready` and the production runtime logs, and report in the owner's format. Docs are append-only: add a dated chunk to `docs/commercial-v1/known-issues.md` for each package.
