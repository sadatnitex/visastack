# Session handoff, 25 October 2026

Written at the end of a long session so a fresh session can continue with full context. Read this file, `CLAUDE.md` and `docs/upgrades/programme/STATUS.md` (the newest copy is on branch `claude/prog-v3-tabs`) first. Everything below was true when written; check the current head SHA before acting.

## 1. Merged and live today

| PR | What | Live checks |
|---|---|---|
| #247 | Production-only deploys (no branch previews) | passed |
| #249 to #252 | Sliced V logo, before or after tax, Title Case, documents behind details | passed |
| #253 | Schema drift guard and Renovate config | passed |
| #254 | AI review Phase 1: "Check What We Found" | passed |
| #255 | Sign-in checks once per page render | passed |
| #256 | WP-V4 W0 ledger (docs) | deployed |
| #257 | Central access gate (`packages/services/src/access/`), not used by any page yet | CI green on merge |

Post-merge evidence comes from: CI on main, Deploy Smoke and Playwright Deploy Smoke runs with conclusion success for the merge SHA (filter `list_workflow_runs` by status success; the skipped runs are the live-check environment), and the Live signed-in check workflow. The live domain is not reachable from the container (DNS); Vercel MCP now works (team access was approved).

## 2. Branches in flight (all pushed)

| Branch | State | Next step |
|---|---|---|
| `claude/ai-review-polish` | Design fidelity polish of the AI review cards plus independent-review fixes (held buttons keep accessible names; lock test). Local full check was running at handoff (audit, lint, typecheck, tests passed). | Re-run the full local check, open a draft PR, CI, merge. Independent review already done (no blocker, fixes applied). |
| `claude/document-protection-switches` | Platform admin switches for restricted documents (table `document_protection_settings`, migration `0087_document_protection_settings.sql`, service `document-protection.ts`, page `/app/admin/document-protection`). Independent review: no blocker; 5 should-fix items plus owner's "reason required" were being fixed by a helper at handoff. | Check the helper's last commit is pushed; verify each review item (list in section 4); short re-review; full local check; PR; CI; run the production migration (owner approved, see section 3); merge. Merge order: migration must run before or with the deploy, or the admin page must show the "not available yet" notice (review item 2). |
| `claude/prog-v3-tabs` | WP-V3 part 2: four tabs (Home, Record, Cases, Sharing) and the Record hub. Two independent reviews passed; design fidelity fixes and three preview fixes done (head `e8867d7`, 530 web tests pass, typecheck clean). One wording test fix confirmed; the last full local run predates the latest fixes. | Render the owner preview (section 6), publish it, get owner approval, then full local check, PR, CI, merge. |

## 3. Owner decisions recorded today

- Restricted documents (step-up before preview or download): identity and civil-status group, medical group, financial group, plus any document whose type is not known yet; all switchable by platform admins once the switches ship.
- A reason is required whenever protection is switched off; it is stored in the settings table only, never in `audit_events` (which cannot be edited or deleted).
- Production migration for `document_protection_settings`: approved, to be run only after its PR is green and independently reviewed (workflow `db-migrate.yml`, confirm "migrate"). No other migration is approved.
- Record hub needs an owner-approved high-fidelity preview before merge.
- WP-V4 questions: option A for all five (see `WP-V4-W0-LEDGER.md`): Do next order as recommended; no change to who sees evidence requests; `packs.ts` read only; `services/src/index.ts` and `lib/labels.ts` may be edited; agency note with a link, email or long number falls back to standard wording.
- AI data plan Phase 2: go-ahead given. Deterministic first slice, nothing new stored.
- Neon: delete only proven-unneeded branches (standing rule). Project `long-sun-23747504` now has 4 branches: main, `preview/claude/clever-sagan-nk7n87` (open PR #177), `preview/public-beta/r2-encrypted-recovery` (keep: verified domain and 14 branch-scoped Vercel variables), `preview/claude/prog-email-invites` (one check left: compare compute last active with deployment dpl_8mdQ built 07:32 UTC).

## 4. Admin switches: review items to confirm on the branch

1. Settings read failure restricts everything (all groups, unknown types) and is reported, not silently swallowed.
2. Admin page shows a plain notice instead of erroring when the table does not exist yet.
3. Reason hint "Say why, without names or document details."; reason not copied to `audit_events`.
4. Each reason input has a distinct accessible name.
5. Category card wording says when some types are switched off one by one, or still protected.
6. Server action requires confirmation for any change that removes protection.
7. Focus returns to the opening button after Cancel.
8. "If reset: On/Off" label for types.
9. Reason required when removing protection (service, action, form).

## 5. Still to do, in order

1. Finish and merge the three branches in section 2.
2. WP-V3 part 3: Application Memory and prior versus current (WORK-PACKAGES.md WP-V3 item 3). Branch from main after part 2 merges, or from main avoiding the Record hub files.
3. WP-V4 agency slice: E02 triage, Do next, follow-up message, ADR (owner answers above). Home page parts (U03) wait for V3 part 3 because both edit `app/app/page.tsx`.
4. AI data plan Phase 2 insights: evidence map plus mismatch, coverage, expiry timeline, originals checklist, readiness per case; summaries only, no sensitive values in insight text; new page linked from the documents page.
5. Access gate adoption across the 313 baselined service functions, in slices, after the branches above merge (it touches most service files).
6. WP-V5, WP-V6, AI Phase 3 ("Your Data" control centre).
Small follow-ups: Record hub erasure check (needs a services export); two section name mismatches ("Dates & Expiry" vs "Expiry & freshness", "History" vs "Fact History"); passport document grouped under Identity while the Passport profile section is under Travel Documents (ask owner).

## 6. Owner preview recipe (Record hub)

The repo's capture tool renders test pages with the real stylesheet: write a temporary vitest file in `apps/web/src/` that mocks `@visastack/services` (getApplicant, listApplicantProfile, getProfileSectionState, getWalletView, listDocumentsDetailed), `./lib/session` and `next/navigation`, renders the real `record/page` with made-up data through `renderServer` from `lib/next-mocks.test-support`, run it with `UI_VISUAL_CAPTURE_DIR=<dir>`, then `node scripts/ui-baseline/capture.mjs <dir> <out>` for desktop and phone PNGs. Delete the temporary test afterwards. The layout's Record tabs render through the applicant layout, so render the layout too or show them separately.

## 7. How work was run safely

- One git worktree per branch under the session scratchpad; helpers edit and run only targeted tests with `nice -n 15`; full checks run one at a time.
- Full local check (one background script): `pnpm audit --prod --audit-level high`, `pnpm run lint`, `pnpm run typecheck`, `pnpm run test`, web vitest, `pnpm --filter @visastack/web build`, then `next start -p 3100` with `NODE_ENV=production DEPLOYMENT_MODE=controlled_pilot IDENTITY_PROVIDER=neon_auth NEON_AUTH_BASE_URL=https://auth.placeholder.invalid/neondb/auth NEON_AUTH_COOKIE_SECRET=<random hex>`, Playwright with a throwaway config (testDir `apps/web/e2e`, specs ux-public, browser-security, no-secret-auth; chromium `/opt/pw-browsers/chromium` with `--no-sandbox`), and `SMOKE_BASE_URL=http://localhost:3100 node apps/web/scripts/smoke.mjs`.
- Em dash sweep uses the three-dot diff: `git diff --text origin/main...HEAD`.
- Append-only `known-issues.md`: on merge conflicts keep both sides and move the branch's own entry to the end.
- Independent review (Opus) before every merge; its findings fixed or answered first.
- Right after opening a PR, unsubscribe from its activity events; check CI with the GitHub tools.
- Killing a background check: kill by process id, never `pkill -f` with a pattern that matches your own shell.
