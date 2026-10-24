# WP-A0 audit record

Read-only audit for Programme X. Main SHA `84cc84ef18b3486c09c6537c25ecaed51539d499`, the same commit as the planning reference `84cc84e`, so no files changed since planning. Branch `claude/prog-a0-audit`. No file under `apps/`, `packages/`, `infra/` or `.github/` was changed.

## 1. Harbor lock

| Check | Result |
| --- | --- |
| `sha256sum docs/design/harbor-v2/00_authority/CONCEPT1_FROZEN.html` | `894253b7a9d8ebb56abd522d8237a8768476ad98555f779e5efced815d522a10`, matches |
| `FILE_INTEGRITY_SHA256.txt` (35 files) | all match |
| `06_quality_gates/verify_harbor_lock.py` | PASS: no geometry, DOM or non-colour drift at 1440, 1024, 768, 390; contrast CTA 8.27, headline 15.59, body 6.34, muted 4.84, success 6.2, warning 6.1, error 7.18, on-dark 17.43. Known source debt: sideways scroll at 768 |

How it was run: the script expects `/usr/bin/chromium`, `tinycss2` and Python Playwright, none of which are installed. It ran on a scratch copy of the package with a throwaway Python environment and the container's Chromium path. The committed package is untouched: the script rewrites `QA_REPORT.json` and two screenshots when it runs, so running it in place would have changed hashed files.

## 2. Head start facts checked

| Package | Fact | Result |
| --- | --- | --- |
| WP-V1 | `client-invitations.ts` is 502 lines and accepts any signed-in account | True. The preview also returns the agency-typed `displayName` and `requestedRoute`, which v1.2 B09 forbids on a public preview |
| WP-V1 | `sharing-invitations.ts` (260 lines) has recipient checks | True: the recipient email must match the signed-in account (`previewSharingInvitation`) |
| WP-V1 | `safeReturnPath` used by sign-in, sign-up and verify-email | True, also by reauth and session-reauth |
| WP-V2 | `conflicts` table about line 1874 requires an AI proposal | True: `field_proposal_id` is NOT NULL (line 1878); the only writer is `ai.ts:2708` |
| WP-V2 | `revealFactVersionValue` about line 399 of `profile.ts` | True (line 399) |
| WP-V2 | `material-revision.ts` is 131 lines | True |
| WP-V5 | `export.ts` 333 lines, `export-csv.ts` 131 lines | True |
| U01 ledger | "`profile-sections.ts` named by v1.2 not found" | Corrected: `apps/web/src/lib/profile-sections.ts` was removed after the 12 Oct checkpoint; `packages/services/src/profile-sections.ts` now holds sections and completion |
| New since v1.2 was written | | Effective dates: `effectiveFrom` falls back to the save time when unknown (`profile.ts:320`), which conflicts with "unknown dates stay unknown". Country sheets (#220-#229) are a new reference source for WP-V4 presets |

## 3. E02 state mapping (table, not code)

One primary status per item, from existing values only. Freshness, sharing and safety processing stay separate indicators.

| E02 group | Evidence request status (`evidence_request_status`) | Document state and safety | Review and decision values |
| --- | --- | --- | --- |
| Missing | `OPEN` with no response | none | none |
| Processing | `RECEIVED` | `UPLOADING`, `QUARANTINED`, `SCANNING`, `NORMALIZING`, `EXTRACTING`; safety `PENDING`, `SCANNING` | none yet |
| Received or awaiting confirmation | `RECEIVED`, `UNDER_REVIEW` | `AWAITING_REVIEW`; safety `CLEAN` | document review `PENDING` |
| Needs correction or clarification | `NEEDS_REPLACEMENT` | `NEEDS_ATTENTION`, `FAILED`; safety `QUARANTINED`, `FAILED` | decision `NEEDS_REPLACEMENT`, `CONTRADICTION`, `CORRECTION_PROPOSED`; document review `REPLACEMENT_REQUIRED`, `DISPUTED` |
| Reviewed | `ACCEPTED`, `FULFILLED` | `APPROVED` | decision `ACCEPTED`; document review `ACCEPTED` |
| Ready for review | Case level, not item level: every required item is Received or Reviewed in `computeReadiness` (`missions.ts:871`) | | |
| No group | `CANCELLED`, `DECLINED` | | document review `IRRELEVANT` |

Open point for WP-V4: `DECLINED` means the traveller declined. v1.2 says withheld information stays unknown, never an adverse label, so it should show as "Declined" with no warning tone. The owner confirms the wording in WP-V4.

## 4. Scorecard baselines (local-lab, D16)

Every browser number below is local-lab: measured on a local production build, to be repeated on the live site when it is reachable. Values, methods and limits are in `COVERAGE-LEDGER.csv` rows X01-X14. Summary:

| ID | Baseline | Method |
| --- | --- | --- |
| X01 | Current landing passes at 360x640 and has no sideways scroll 320-1440 | `scripts/programme/landing-baselines.cjs` |
| X03 | 3 setup screens, 4 setup steps | Route reading of `setupSteps` in `apps/web/src/app/app/page.tsx`. Not a Playwright count; WP-V1 or V3 re-measures it |
| X08 | 0 axe violations on 5 public pages at 1440 and 390 | Same axe tags as `e2e/ux-public.spec.ts`. Auth and app pages not measured |
| X10 | Not measured | No usable staging agency account in this container |
| X13 | Landing LCP median 1048 ms | 390x844, CPU 4x, 150 ms latency, 1.6 Mbps, cold, local server. Home not measured |

All browser numbers come from a local production build of main, not the live site: the live domain refused the container's network (proxy 403).

How to rerun: `pnpm --filter @visastack/web build`, then from `apps/web` run `next start -p 3100` with `NODE_ENV=production DEPLOYMENT_MODE=controlled_pilot` and dummy auth values, then `node scripts/programme/landing-baselines.cjs <output-folder>`.

## 5. Landing preview (step 10)

- Before: `previews/landing/before-harbor-<width>.jpg`, the frozen Harbor homepage.
- After: `previews/landing/after-corrected-<width>.jpg` from `previews/landing-preview-corrected.html`.
- Current site for comparison: `previews/landing/current-live-build-<width>.jpg`.
- Widths: 1440, 1024, 768, 390, 360.

`scripts/programme/make-landing-preview.cjs` builds the corrected preview from the frozen source and gives the same output every time. Changes, each labelled `OWNER-EXTENSION` in one CSS block:

| Decision | Change in the preview |
| --- | --- |
| D4 | No sideways scroll at 768 and 360 (header links fold into a menu at 900px and below; header button hidden at 420px and below) |
| D4 | Floats sit in a column under the phone at 900px and below, so they no longer cover the phone text |
| D4 | Caption sits under the floats instead of over the phone |
| D4 | Phone menu with Product, For agencies, Privacy and control, How it works, Sign in, 44px targets, no script |
| D5 | Phone bottom tab reads Record instead of Documents |
| D5 | The "Prepared again, faster" float becomes "Reminder before it expires" (expiry reminders exist today) |
| House rule | Two long dashes in the source become a hyphen and a comma |

| D15 (part of D4) | At 901-1100px only, fc1 moves to `left:2%` and fc4 to `right:2%`, so neither covers the phone at 1024. 1440 is unchanged: its screenshot is byte-identical before and after this change |

Measured result (`previews/landing/measurements.txt`): after the corrections no float covers phone text and nothing scrolls sideways at any of the five widths. The script counts only the part of the phone screen that is actually visible: a panel that runs past the phone frame is hidden by the frame and cannot be covered. WP-L1 builds the same corrections in production code. Links still point where the Harbor source points; D3 destinations are applied in WP-L1 code, not in this preview. This is a preview, not production code.

## 6. Conflicts found outside the register (resolved by the owner on 24 Oct 2026)

Both are now recorded in `PROGRAMME.md` section 3. CR13: the Harbor folder is an immutable external reference, exempt from the dash rule; the guard has `--exclude` and the `CLAUDE.md` sweep excludes the folder. CR14: `biome.json` ignores the Harbor folder. The table below is the original finding.

| ID | Conflict | Options | Recommendation |
| --- | --- | --- | --- |
| CR13 | 59 lines in the hash-locked Harbor files contain long dashes. The repo's no-long-dash sweep and `check-allowed-paths.mjs --no-emdash` fail on these files alone | (a) treat `docs/design/harbor-v2/**` as a verbatim third-party reference, exempt from the dash rule, with an `--exclude` option in the guard; (b) keep only the original zip in the repo instead of extracted files; (c) edit the dashes and re-sign the lock | (a): the lock exists to prove the files are exactly as supplied |
| CR14 | `pnpm run lint` runs `biome check .`, which fails on 9 Harbor JSON and CSS files. Reformatting breaks the lock (`HARBOR_C1_COLOR_ONLY.css` is hashed) | (a) add `"docs/design/harbor-v2/**"` to `files.ignore` in `biome.json`; (b) same as CR13 (b) | (a): one line, outside the WP-A0 allowlist, so it needs your approval |



## 7. Drift guard wiring (proposal, not applied)

- Root `package.json` `test` script: add `scripts/programme/check-allowed-paths.test.mjs` to the existing `node --test` list.
- `.github/workflows/ci.yml`: add the same test file to the `node --test` line at about line 159, next to the other script tests.
- Programme branches only: one CI step that runs `node scripts/programme/check-allowed-paths.mjs docs/upgrades/programme/allowlists/<WP>.txt --no-emdash` when the branch name matches `claude/prog-*`, with `<WP>` taken from the branch name. It needs a full fetch of `origin/main`. Run it with `--no-emdash --exclude docs/design/harbor-v2` (CR13).

All three touch files outside every allowlist, so they need your decision and their own small PR.

## 8. CLAUDE.md addition (applied with the owner's approval)

The four lines from `CLAUDE-MD-ADDITION.md` are in `CLAUDE.md` section 2, with the approved tweak: the guard command ends with `--no-emdash --exclude docs/design/harbor-v2`. The dash sweep in section 3 now excludes the Harbor folder. The package brief calls it a "6-line addition"; the file held 4 lines, and those 4 were applied.

## 9. Not verified in this package

- The live site: the landing, `/api/health/ready` and all browser numbers were measured on a local build. The live domain was unreachable from this container.
- Auth pages (`/auth/*`): they returned 404 locally because this container has no Neon Auth configuration, so they have no screenshots and no accessibility count.
- Signed-in screens: X03 is from code reading; X10, X11 and the Home LCP were not measured.
- Known-issues log: the WP-A0 chunk is appended to `docs/commercial-v1/known-issues.md` (approved addition to the allowlist).
- The deployed Next.js version: the Vercel connector was refused access to the team (403), so it was not read from the deployment.
