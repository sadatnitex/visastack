# Session handoff, 25 October 2026 (evening)

Supersedes `SESSION-HANDOFF-2026-10-25.md` for current state; that file stays as history. Read this, then `CLAUDE.md`, then `docs/upgrades/programme/STATUS.md` (newest copy on main, or on `claude/prog-v3-memory` until #265 merges). Everything below was true when written; check each head SHA before acting.

## 1. Merged and live today (all post-merge checks passed)

| PR | What | Notes |
|---|---|---|
| #259 | Check What We Found: design polish | |
| #260 | Document protection switches for platform admins | Production migration 0087 run by owner approval right after merge (88 migrations applied, table empty) |
| #261 | WP-V3 part 2: four tabs and the Record hub | Owner approved the preview with three changes (travel documents beside Passport details; Update Details; no-kind documents need a check) |
| #262 | AI data plan Phase 2: What Your Documents Show | Restricted documents named by kind and section only (owner: safer default) |
| #264 | Title Case for every name, one family of form fields | Widened Title Case guard; `--control-height` 48px; dropdown arrow is `/icons/select-chevron.svg` |
| #263 | WP-V4 agency slice: triage, Do Next, follow-up message | ADR 0015 |

Live evidence for each: CI on main, CodeQL, Vercel status, Deploy Smoke and Playwright Deploy Smoke (the run with conclusion success; skipped runs are the other environments), Live signed-in check.

## 2. Open PRs and branches (all pushed)

| Branch | PR | State | Next step |
|---|---|---|---|
| `claude/prog-v3-memory` | #265 | WP-V3 part 3 (Application Memory, Then and Now, changes in the case alert). Reviewed twice, fixed. CI running at handoff | Merge on green (owner said "merge when green") |
| `claude/account-menu` | none | Account menu redesign. Reviewed (approve), fixes applied (3c9152d). Owner saw before/after | Merge main, full check, PR, merge |
| `claude/ai-naming-sorting` | none | AI document kind and name, saved only on Accept. Reviewed twice. Owner: suggestion only on request; passport machine-readable fields stay automatic; AI may suggest ANY kind with a warning when accepting removes the fresh sign-in check. Main merged at ab15d9d | Full check, PR, merge |
| `claude/profile-photos` | none | Profile photos (owner photo on the SELF traveller record), data export includes photos. Strict review: no hole; fixes applied; re-review running at handoff. **Migration 0088 (`applicant_photos` table, new erasure reason) needs the owner's explicit word before the production run.** Code tolerates the table missing (savepointed 42P01 check) | Re-review result, merge main, full check, PR, CI, ask owner "migrate", merge, run `db-migrate.yml` immediately after merge (it only runs from main) |
| `claude/status-and-redaction-labels` | none | Status page AI state from the same decision as real AI calls (60 s cache); "Download Redacted Copies" disabled with "Not available yet", server refuses it. Reviewed (approve); two nits being applied | Merge main, full check, PR, merge |
| `claude/visa-photo` | none | Visa photo sizes from one PHOTOGRAPH document (on-demand sized JPEGs per country rule with source and checked date; agencies through existing download grants). Builder still working at handoff; nothing committed yet | Builder report, independent review, check, PR |
| `claude/ai-provider-switching` | none | NOT switching (that exists already: admin AI settings activate, rollback, emergency disable, fallback). Scope: per-configuration data terms, a warning-only rule (owner: do NOT block free API tiers until told; enforcement switch built but OFF), runbook, compliance review and privacy-notice draft (`docs/legal/`). Builder working at handoff | Builder report, review, check, PR |
| `claude/clever-sagan-nk7n87` | #177 | Older owner PR (open sign-up), untouched | Owner's call |

Merge order that avoids rework: each branch takes the latest main before its final check. After #264, new user-facing names must pass the widened Title Case guard (`apps/web/src/lib/title-case.test.ts`) and the product-word guard (`vocabulary.test.ts`: never "mission" in visible text).

## 3. Owner decisions today (also in STATUS.md)

- Record hub: three answers above; preview approved.
- Insights: restricted documents by kind and section only.
- AI naming: on request; passport machine-readable fields automatic; any kind with warning.
- Profile photos: one photo per person; include in data export; migration 0088 needs a separate "migrate" word.
- Visa photo: one upload, sized copies per published country rule, no face or background editing, never claim acceptance.
- AI providers: free tiers allowed now; record data terms; warn, never block, until the owner says so.
- Parked until the owner says start: **payments** (plan: provider-agnostic port, Stripe first, a Bangladesh gateway next) and **real redaction** (rasterise pages and burn out protected areas). Do not start them.
- Engineering roadmap (owner, 25 Oct): steps 1 to 3 done (#246, #253, #255), step 4 half (gate merged #257; adoption across ~313 service functions in shadow mode still to do), step 5 (signed step-up proof replacing `stepUpSatisfied: true` booleans in about 10 web action files) next once WP-V3 files are free. Renovate app installed by the owner; dashboard issue not yet seen at handoff, check it appeared.

## 4. How the work was run (keep doing this)

- One git worktree per branch under the session scratchpad; helpers build and run only targeted tests with `nice -n 15`; one full local check at a time per port.
- Full local check script: audit, lint, typecheck, `pnpm run test`, web vitest, build, `next start` on a port with the placeholder Neon Auth settings and a 64-hex secret (generate with `od -An -tx1 -N32 /dev/urandom | tr -d ' \n'`; `xxd` is not installed and an empty secret makes `/app` return 500), Playwright (ux-public, browser-security, no-secret-auth) with a throwaway config, smoke. Two checks can run at once on different ports, but the machine then gets slow enough for 15 s test timeouts; prefer one.
- Independent Opus review before every merge; re-review after fixes; strictest level for storage, deletion, sharing, auth and migrations.
- CI watching: `gh api repos/sadatnitex/visastack/commits/<FULL sha>/check-runs` in one background loop (a short or mistyped SHA silently never matches). Unsubscribe from PR activity right after opening a PR.

## 5. Pitfalls found today

- **Merging `globals.css`:** never resolve conflict hunks by concatenating sides; a hunk can split a rule and silently put a block inside another rule. Use: main's file, then the branch's own additions relative to the merge base (works when the branch only appended). Check `grep -n '^/\* WP-' apps/web/src/app/globals.css`.
- **Marked CSS blocks:** each package's block must start with `/* WP-<ID> ...` on its first line; guard tests end a block at the next such marker. A block starting `/* ====` broke the Record hub guard twice.
- **Coverage ledger CSV:** a conflict can duplicate rows; keep one row per id (the package that updated it wins).
- **Stored values vs labels:** answers such as "Before tax" are stored values; never change them in a Title Case pass. Only change display maps keyed by codes.
- **Killing background jobs:** never `pkill -f` with a pattern that also matches your own command line; kill by process id.
- **Flat-design rule:** no gradients or shadows outside `landing-c1.css`; the security policy blocks `data:` images, so icons in CSS are same-site files under `apps/web/public/icons/`.
- **CodeQL:** test code counts; decode `&amp;` last when un-escaping.
- **Migrations:** `db-migrate.yml` runs only from main, so code is live minutes before a new table exists; code must tolerate the table missing, then run the migration right after merge.
- **Usage limits:** about six concurrent Opus helpers hit the session limit once; keep parallel helpers to about four.

## 6. Owner preferences that shape every answer

Plain language, no em dashes, Title Case for names, lead with the answer, tables for status, report after each merge with Area | What changed | What you will see | Who notices, then Checked live / Not live yet / Not yet checked / Needs you, ending with what was done and one next step.

## 7. Addendum, 26 October 2026 (night): everything in section 2 is merged

Sections 1 to 6 stay as written; this section supersedes section 2.

| PR | What | Production database |
|---|---|---|
| #265 | WP-V3 part 3 | none |
| #267 | Account menu redesign | none |
| #268 | AI document kind and name, saved only on Accept | none |
| #269 | Profile photos | migration 0088 run right after merge (owner approved) |
| #270 | Status page AI state from the same decision as live AI calls; DOWNLOAD_REDACTED shown as "Download Safe Copies" and grantable (owner choice A) | none |
| #271 | Visa photo sizes (agencies use Download Safe Copies plus Preview) | none |
| #272 | AI provider data terms, training guard built and OFF, compliance review and runbook | migration 0089 run right after merge (owner approved); 90 migrations applied |

Open from this session: none. Older owner PRs #177 and #77 are untouched.

What the next agent should know:

- **AI data rule:** `decideAiProviderUse` (packages/services/src/ai-data-terms.ts) is the one rule; it runs inside `selectAiExtractionSource` (apps/web/src/lib/ai.ts), so the status page and live calls agree. With the setting off (the default, and also when it cannot be read) nothing is blocked. Do not turn it on or make a failed read block without the owner's word.
- **Schema constants in services:** never read `schema.X` at module load in packages/services (tests that mock @visastack/db crash). Copy the literal and pin it with a test, as document-protection.ts and ai-data-terms.ts do.
- **After merging main into a worktree, run `pnpm install`** before a full check: a new dependency on main (sharp, from #269) otherwise shows up as typecheck and build failures that are not in the code.
- **Accessibility guards:** a button busy while something runs uses `aria-disabled`, not `disabled` (apps/web/src/lib/accessible-forms.test.ts); every exported form must be rendered in apps/web/src/lib/a11y-forms.test.tsx.
- **Supply-chain scan:** a regular-expression `.exec(` is read as shell execution; use `.match`.
- **Evidence log merges:** `branch-append` style resolution (main's file plus the branch's own additions) drops any uncommitted edit to the branch's entry; commit entry edits before resolving.
- **Renovate:** the owner installed the app, but no Dependency Dashboard issue or Renovate PR has appeared. Likely the app was not given access to this repository; the owner checks the installation's repository list.
- **Next work:** WP-V4 Home parts (U03), then the rest of WP-V4, WP-V5, WP-V6; engineering roadmap step 4 adoption in shadow mode and step 5 (signed step-up proof replacing `stepUpSatisfied: true` in about 10 web action files); sweep follow-up (three long labels move their bracketed explanations into field hints). Payments and real redaction stay parked.
- **Open question, Playwright Deploy Smoke after #272:** run 40248606409 attempt 1 failed one test (`documents keeps identical pixels under both device appearances at 1600px`: the light and dark captures differed); attempt 2 on the same commit passed. #272 changed no file on that screen, and the same test passed on the same tree in PR CI and in the local check. Attempt 1 started at 00:17 UTC while migration 0089 was being applied, so the page may have changed between the two captures; this is not proven (the screenshot artifact could not be downloaded from the session container). If it fails again outside a migration window, read the two attached screenshots first.
