# Work packages

Master contract: `PROGRAMME.md`. Read it first. This file holds one brief per package. Each session reads only its own brief.

Conventions used below:

- "(new)" after a path means the file does not exist yet.
- "Head start" lists facts verified in the repo at `84cc84e`. They are not a substitute for the W0 check in WP-A0, and each must be re-verified before relying on it.
- Allowlist seed is the starting list for `docs/upgrades/programme/allowlists/<WP>.txt`. The session may propose additions. The owner approves them before they are used.
- Classes: P presentation only, B behaviour, R read-only.

---

## WP-A0 Read-only audit, baselines, Harbor lock, allowlists, drift guard

**Class** R (docs and scripts only). **Branch** `claude/prog-a0-audit`. **Depends on** nothing. **Owner gates** D6, D7.

**Goal.** Establish the facts every later package depends on, without touching application code.

**Steps**

1. Preflight per `CLAUDE.md` section 6. Record the current `main` SHA. If it is not `84cc84e`, list changed files since then.
2. Place the Harbor package under `docs/design/harbor-v2/` (the owner supplies the zip). Verify the lock: `sha256sum docs/design/harbor-v2/00_authority/CONCEPT1_FROZEN.html` must equal `894253b7a9d8ebb56abd522d8237a8768476ad98555f779e5efced815d522a10`, then run `python docs/design/harbor-v2/06_quality_gates/verify_harbor_lock.py`. Report both results. Stop if either fails.
3. Place `docs/upgrades/upgrade.v1.2.execution.md` (unchanged) and this programme folder.
4. Harbor audit (read-only): map every current route to Harbor R01-R30 and write the mapping to `docs/upgrades/programme/ROUTE-MAP.md` (new). Compare the live landing page with `docs/design/harbor-v2/05_visual_previews/C1_HARBOR_HOMEPAGE.html` using screenshots at 1440, 1024, 768, 390 and 360, and list differences.
5. v1.2 W0 delta ledger: for every row in v1.2 section 4 and every requirement U01-U10, E01-E04, write `docs/upgrades/programme/COVERAGE-LEDGER.csv` rows with current file and symbol, existing, partial, missing or blocked, smallest remaining change, and evidence needed. Use the head start facts in each package as a starting point. Map existing evidence-request, review and readiness statuses to the E02 groups (a table, not code).
6. Baselines for the scorecard (PROGRAMME section 5): for X03 the number of screens from confirmed email to first task; for X13 landing and Home lab performance with one stated method; for X08 existing accessibility violations count with the repo's own tooling (or "manual only"); for X10 a timed synthetic agency task on staging if accounts exist, else "not measured". Record method and result. Do not invent numbers.
7. Draft one allowlist per package (WP-L1 to WP-V6) from this file and the audit.
8. Add `scripts/programme/check-allowed-paths.mjs` and its test (provided in the pack) after reading how existing scripts in `scripts/` are structured. Wire nothing into CI yet.
9. Propose, but do not apply, the 6-line addition to `CLAUDE.md` in `docs/upgrades/programme/CLAUDE-MD-ADDITION.md`. The owner approves it.
10. Landing preview for the owner (screenshots of the planned landing at five viewports with the D4 and D5 corrections shown before and after). No production landing code.

**Allowlist seed:** `docs/design/harbor-v2/**` (new), `docs/upgrades/**`, `scripts/programme/**` (new). Nothing else.

**Forbidden:** any change under `apps/`, `packages/`, `infra/`, CI workflow files.

**Acceptance:** Harbor lock verified, ledger complete with no blank status, baselines recorded with method, allowlists drafted, no application file changed (`git diff --name-only origin/main` shows only the allowlisted paths).

---

## WP-L1 Landing page (Harbor R01), first production change

**Class** P. **Branch** `claude/prog-l1-landing`. **Depends on** A0. **Owner gates** D1, D2, D3, D4, D5, and approval of the landing preview from A0 and of the final claim register.

**Goal.** Convert the public homepage to the frozen Harbor C1 reference, truthfully, with the signed corrections. This PR changes no other route.

**Head start (verify)**

- Landing is `apps/web/src/app/page.tsx` (about 512 lines) with `.land-*` styles in `apps/web/src/app/globals.css` (about 120 selectors). It uses `components/hero-example.tsx` and the shared `components/site-navigation.tsx`.
- Tests tied to it: `apps/web/src/app/page.test.tsx`, `apps/web/src/lib/plain-language.test.ts`, `apps/web/src/components/hero-example.test.tsx`, `apps/web/e2e/ux-public.spec.ts`, `apps/web/src/app/public-pages.test.tsx`.
- Existing sections after the hero: summary, problem (before and after), how it works, capabilities with the beta or pilot status sentence (`#capabilities`), for agencies (`#for-agencies`), trust, roadmap, final call to action. Existing status logic uses `isPublicBetaOpen()` and `isSignedIn()`.
- The frozen C1 source uses `box-shadow` and `radial-gradient` and floating notification cards. `scripts/check-flat-design.mjs` forbids shadows, gradients, blur and translucent surfaces. This is conflict CR08 and decision D1.
- The frozen C1 mobile layout shows only the logo and one button in the header, floats overlap the phone heading, the caption overlaps the phone bottom, and the page overflows at exactly 768px (Harbor gate A and D).

**Do not start code until D1 to D5 are answered.** If any is OPEN, finish the preview work, report, and stop.

**Steps**

1. Read in this order: `docs/design/harbor-v2/README.md`, `07_agent_handoff/COPY_PASTE_MASTER_CODEX_CLAUDE_PROMPT.md` section 3, `02_specification/DESIGN_CONSTITUTION_HARBOR_V2.md`, `01_tokens/HARBOR_TOKENS.json`, `01_tokens/C1_GEOMETRY_LOCK.json`, then `00_authority/CONCEPT1_FROZEN.html`.
2. Landing stylesheet. If D1 is (a): create `apps/web/src/app/landing-c1.css` (new) holding only the C1 selectors and Harbor colour variables from `HARBOR_C1_COLOR_ONLY.css`. Read how `scripts/check-flat-design.mjs` chooses files, then add the narrowest possible exception for that one file and extend `scripts/check-flat-design.test.mjs` to prove the same effects still fail anywhere else. If D1 is (b), use the flat equivalents the owner approved. Never weaken the guard for other files.
3. Markup. Build the C1 hero, device stage, four floats (two on mobile), dark chapter with four feature cards, and footer, using the existing React and Next primitives. Keep the frozen geometry: headline weight 820, tracking and clamp values from `C1_GEOMETRY_LOCK.json`, 78px or 68px nav height, phone 335 by 642 or 292 by 555, four or two floats.
4. Navigation (D3). Desktop links: Product `#product`, For agencies `#for-agencies`, Privacy and control `/trust`, How it works `#how-it-works`. Add the `id` attributes to the sections they point at. Mobile (D4): reuse `SiteNavigation` for a compact menu so every link is reachable on a phone. Primary action keeps the existing `startHref` and signed-in logic, so a signed-in visitor goes to the workspace and a closed pilot does not promise open registration.
5. Corrections (D4). Fix the 768px overflow at its root cause (document it; no global `overflow` clipping). Reposition or resize floats and the caption at 390 and 360 so no hero text is hidden. Show before and after screenshots of each.
6. Truthful content (D5). Use the content register below. Replace the phone's bottom tab label Documents with Record. Replace the float "Prepared again, faster" with the expiry reminder float until Prepare again (U02) ships. Keep "Illustrative interface, sample information" next to the phone.
7. Preserved content. Keep the sections C1 does not depict, restyled with Harbor colours only (`EXISTING-PRESERVED` and `HARBOR-COLOR`), in the existing order: problem, how it works (with `id="how-it-works"`), capabilities availability sentence, for agencies (`id="for-agencies"`), trust, roadmap, final call to action. The C1 chapter replaces the old summary panel and the old feature grid. Write a disposition table (every old section and claim: replaced by, preserved, moved, or removed with reason) in the PR.
8. Remove old landing CSS only for selectors proven unused by search. Do not delete anything else.
9. Update the tests named in Head start. Add Playwright checks: no horizontal overflow at 320, 360, 390, 768, 1024, 1440; headline, one primary action and the status line visible without scrolling at 360x640; keyboard opens and closes the mobile menu with Escape returning focus; all landing links resolve (`node scripts/check-route-navigation.mjs`); reduced-motion respected.
10. Run Harbor gates A-F and fill the gate F release block in the PR.

**Content register (claims on the landing; each must be verified with a file and symbol before merge)**

| ID | Claim or text | Pre-assessment | What proves it |
| --- | --- | --- | --- |
| CL01 | Keep a reusable travel record | Likely true | Profile and wallet services and pages |
| CL02 | Prepare your next application | Likely true | Cases (`missions`) |
| CL03 | Share only what you choose | Likely true | Grant form scope and review step |
| CL04 | Float: document needs updating | Likely true | Evidence request replacement state |
| CL05 | Float: previous version kept | Likely true | Document version history |
| CL06 | Float: reminder before a document expires (replaces "Prepared again, faster") | Likely true | `notification-sweep.ts`, `expiry.ts`, expiry page |
| CL07 | Float: access ends on a date, selected records shared | Likely true | Grant `expiryAt` and the optional `expiryDays` field |
| CL08 | Card 1 text "compare earlier versions and reuse the right information in a new case" | NOT TRUE YET. Compare is E03 and U06. Reuse is only partly there | Ship the reduced text: find current documents and see earlier versions. Final text returns in WP-V6 |
| CL09 | Card 2: one clear request with the document needed and the action | Likely true | Evidence request fields (`docType`, `message`, `dueDate`) |
| CL10 | Card 3: select records, review scope, set an access end date before agreeing | True with a note: the end date is optional | `grant-form.tsx` review step and `expiryDays` |
| CL11 | Card 4: accurate history of previous declarations | Likely true | Immutable case snapshots and version history |
| CL12 | Privacy and sharing are governed by actual product permissions | Likely true | Server-side permission checks. Do not add security badges |
| CL13 | One personal record, separate cases, explicit sharing | Likely true | Master profile, missions, grants |
| CL14 | Availability: public beta or private pilot sentence | True, keep it | `isPublicBetaOpen()` |

**Allowlist seed:** `apps/web/src/app/page.tsx`, `apps/web/src/app/page.test.tsx`, `apps/web/src/app/landing-c1.css` (new), `apps/web/src/components/hero-example.tsx`, `apps/web/src/components/hero-example.test.tsx`, `apps/web/src/components/landing-*.tsx` (new), `apps/web/src/app/globals.css` (only unused-selector removal, inside a WP-L1 block), `apps/web/src/lib/plain-language.test.ts`, `apps/web/e2e/ux-public.spec.ts`, `scripts/check-flat-design.mjs` and `scripts/check-flat-design.test.mjs` (only under D1 option a), `docs/upgrades/programme/**`.

**Forbidden:** every other route, auth, consent, services, data model, `workspace-navigation.ts`, the app palette, new fonts, new dependencies, palette switchers, fake counters or endorsements.

**Acceptance:** X01, X02, X06, X07, X08, X12 and X13 evidence attached; Harbor parity measured (computed style and box parity against the frozen reference, colour excluded); every claim row verified; both Harbor-source defects resolved as signed extensions; all G1-G7 gates met.

**Rollback:** revert the PR. The old landing returns because no other file depended on it.

---

## WP-C1 Harbor colour layer (everything except the landing)

**Class** P. **Branch** `claude/prog-c1-colour`. **Depends on** L1 merged. **Owner gates** D9, approval of the derived tints and of each dark-surface colour.

**Goal.** Product, auth and public pages other than the landing change colour from teal and paper to Harbor, with no change to layout, type, radii, controls or behaviour. Inter stays (CR03).

**Head start (verify)**

- `apps/web/src/app/globals.css` is about 6,100 lines. Besides root tokens it holds about 60 distinct hard-coded colour literals, about 25 of them teal or green tints (for example `#eef6f1`, `#e9f3ed`, `#e0f2eb`, `#d1e3dd`, and `#075d54` 14 times, `#d9f3e9` 9 times).
- Other files with the old colours: `apps/web/src/app/layout.tsx` (`themeColor: '#f9f8f5'`), `apps/web/src/lib/agency-brand.ts` (`INK = '#152b37'`) and its test, `apps/web/src/app/app/agency/[orgId]/branding-form.tsx` (agency preset swatches, including Teal; these are agencies' own choices and stay).
- Four rules set a rust serif accent word: `.land-title em`, `.auth-introduction em`, `.land-summary-panel h2 em`, `.trust-hero h1 em`. The landing ones are owned by WP-L1. Here change `.auth-introduction em` and `.trust-hero h1 em` to the heading font and `var(--accent)`, keeping `display: block` and letter-spacing.

**Token map (live to Harbor)**

| Live token | Now | Harbor | Harbor source |
| --- | --- | --- | --- |
| `--bg` | `#f9f8f5` | `#F7F9FE` | `bg-subtle` |
| `--bg-elevated` | `#ffffff` | `#FFFFFF` | `surface-elevated` |
| `--bg-subtle` | `#f0eee8` | `#EDF1F5` | `state-neutral-bg` |
| `--text` | `#152b37` | `#13243D` | `fg-primary` |
| `--text-secondary` | `#304450` | `#516174` | `fg-body` |
| `--text-tertiary` | `#526862` | `#647386` | `fg-muted` |
| `--accent`, `--accent-strong`, `--brand` | `#087a68` | `#1D4C98` | `brand-primary` |
| `--accent-hover` | `#075d54` | `#143B7A` | `brand-primary-hover` |
| `--brand-bg` | `#d9f3e9` | `#E8F0FC` | `selection-bg` |
| `--selected-text` | `#075d54` | `#1D4C98` | `selected-border` |
| `--hairline`, `--hairline-soft` | `#d8ded6`, `#e8eae5` | `#CAD4E2`, `#E4E9F1` | `stroke-default`, `stroke-subtle` |
| `--success`, `--success-bg` | `#075d54`, `#d9f3e9` | `#176E52`, `#E8F4EE` | `state-success-fg`, `state-success-bg` |
| `--warning`, `--warning-bg` | `#865014`, `#fff0db` | `#92512F`, `#FBEEE7` | `state-warning-fg`, `state-warning-bg` |
| `--danger`, `--danger-strong`, `--danger-bg` | `#963932`, `#b94945`, `#fbe9e5` | `#A32935`, `#A32935`, `#FBEAEC` | `state-danger-fg`, `state-danger-bg` |
| `--nav-material` | `#f9f8f5` | `#F7F9FE` | `bg-subtle` |
| Deep navy accents | `#102937`, `#183844` | `#0B1A30` | `bg-chapter` |

Every value and token name in this table was checked against the Harbor package when this plan was written (the JSON keys read `state.success.fg` and so on; the CSS variables read `--vs-state-success-fg`). Verify each again against `docs/design/harbor-v2/01_tokens/HARBOR_TOKENS.json` before editing. If a value differs, the JSON wins and the difference is reported.

**Derived tints** (mixes of `#1D4C98` into white, not in the Harbor package, need owner approval): `--brand-tint-1 #F4F6FA`, `--brand-tint-2 #EDF1F7`, `--brand-tint-3 #E4EAF3`, `--brand-tint-4 #D2DBEA`, `--brand-tint-5 #B0C0DB`. They replace the green and teal tint literals. Literals used on dark navy surfaces (for example `#9ae0c9`, `#8de0be`, `#136d5f`, `#086d5e`) are listed in the PR and each gets an owner-approved Harbor light colour before editing.

**Steps**

1. Capture before screenshots per `CHANGE-SAFETY.md` plus the Harbor viewports.
2. Edit root tokens, add tint tokens, replace literals, change `themeColor`, `INK` and its test, and the two serif accent rules. Write `docs/upgrades/programme/colour-map.md` (new) mapping every old literal to its new token and Harbor JSON path. Label every CSS change `HARBOR-COLOR`.
3. Add `apps/web/src/lib/palette-contrast.test.ts` (new): assert WCAG contrast (reuse `contrast()` from `agency-brand.ts` if exported) for body on `--bg` and white, secondary and tertiary text, white on primary, primary on `--bg`, each status text on its tint, and the focus ring on white.
4. After the change search the repo for every old hex. The only allowed survivors are the agency preset swatches and the chart tokens `--seg-0` to `--seg-5` (separate later proposal).
5. Capture after screenshots. Every screen changes, because colour is global. The pass rule is therefore: you read every pair and accept colour differences only. Any shift in position, size or wrapping is a defect.

**Allowlist seed:** `apps/web/src/app/globals.css`, `apps/web/src/app/layout.tsx`, `apps/web/src/lib/agency-brand.ts`, `apps/web/src/lib/agency-brand.test.ts`, `apps/web/src/lib/palette-contrast.test.ts` (new), `scripts/ui-ratchet.baseline.json` (lower only), `docs/upgrades/programme/colour-map.md` (new), `docs/upgrades/programme/**`.

**Forbidden:** layout, spacing, radii, type sizes, fonts, 44px controls, routes, actions, permissions, copy, landing stylesheet, agency preset swatches, chart tokens.

**Acceptance:** `palette-contrast.test.ts` green; no old hex left except the two allowed groups; ratchet and flat-design guard pass; screenshot pairs show colour only; X06, X08 evidence; sign-off on a representative set at 1440 and 390: auth, traveller home, case, sharing, agency overview, admin overview.

**Rollback:** revert the PR.

---

## WP-P0 WorkOS retirement

**Class** B. **Branch** `claude/prog-p0-workos`. **Depends on** C1. **Owner gates** D10 and an approved brief.

**Head start (verify).** WorkOS is still present at `84cc84e`: `authkitMiddleware` in the middleware, the `@workos-inc/authkit-nextjs` dependency in `apps/web/package.json`, the callback and session re-authentication routes, and `WORKOS_*` checks in readiness. Identity is selected through `IDENTITY_PROVIDER`; Neon Auth is the target.

**Steps.** (1) Session 1 only: list every runtime reference (`rg -l -i workos apps packages`), classify each as runtime code, test, doc or stored data, and write the brief: exact files to change, tests to keep or port, data that must stay untouched. Stop for owner approval. (2) After approval remove only the WorkOS runtime branches and dependency, keep stored identity-binding data intact, keep every journey covered by a Neon Auth test, update docs. (3) Prove on staging with synthetic accounts that sign-up, sign-in, email confirmation, recovery, re-authentication and sign-out work with Neon Auth only.

**Forbidden:** destructive database changes, migrations that drop identity columns, removing tests to make the build pass, touching UI.

**Acceptance:** no WorkOS import or dependency remains in runtime code; all auth journeys green on staging; `pnpm audit --prod --audit-level high` exit 0; CI green on the head SHA; owner approval of the brief recorded.

---

## WP-V1 v1.2 PR1/S1: invitation identity, neutral preview, return path

**Class** B. **Branch** `claude/prog-v1-identity`. **Depends on** P0. **Spec** v1.2 section 6 row PR1/S1, B09 (U07), E01 return-path security, tests T02-T05, T15-T16.

**Head start (verify).** `packages/services/src/client-invitations.ts` (502 lines) states in its own header that acceptance is deliberately not keyed by email and works for any signed-in account, and records `acceptedByAccountId` from the actor. That is the gap v1.2 PR1/S1 targets (intended-recipient binding). `packages/services/src/sharing-invitations.ts` (260 lines) is reported by v1.2 to have recipient checks; verify. The return path already exists: `safeReturnPath` in `apps/web/src/lib/neon-recency.ts` is used by the sign-in, sign-up and verify-email actions, and `next` is carried through them. Reuse it; add tests for open-redirect cases and for invitation, sign-up, email confirmation and accept returning to the correct task.

**UX integration.** Invitation accept screens keep their layout. Colour comes from WP-C1. Any visual or copy change beyond that needs an approved preview. A wrong-account or forwarded link shows a neutral unavailable message with no personal metadata. A preview GET never claims an invitation.

**Allowlist seed.** Determined by the A0 ledger. Likely: `packages/services/src/client-invitations.ts` and `.test.ts`, `packages/services/src/sharing-invitations.ts` and `.test.ts`, `apps/web/src/lib/neon-recency.ts` and its tests, `apps/web/src/app/app/client-invitations/**`, `apps/web/src/app/app/sharing-invitations/**`, `apps/web/src/app/invitation/**`.

**Acceptance:** T02-T05 and T15-T16 for the affected cases, R01 return-path cases, forwarded, unrelated, replayed and revoked invitations cannot claim or reveal; no duplicate case; token hashed, expiring, absent from logs and referrers; ledger rows with exact outcomes.

---

## WP-V2 v1.2 PR1/S2: version and time semantics, change impact, consistency foundation

**Class** B. **Branch** `claude/prog-v2-time`. **Depends on** V1. **Spec** v1.2 PR1/S2, B06 (U04), B07 (U05), E03 service foundation, tests T06, T10-T12, R05, R06.

**Head start (verify).** `packages/db/src/schema.ts` defines a `conflicts` table (about line 1874) that v1.2 says required an AI field proposal; confirm current behaviour. `revealFactVersionValue` is in `packages/services/src/profile.ts` (about line 399). `packages/services/src/material-revision.ts` (131 lines) and `wallet.ts`, `documents.ts` hold replacement and invalidation. Do not create fake AI proposals to store general conflicts. Add an additive schema change only if the W0 ledger proves nothing fits and the owner approves.

**UX integration.** No visible UI in this package beyond minimal wording in existing screens. The result vocabulary is fixed (PROGRAMME section 8). Prior-versus-current UI lands in WP-V3.

**Acceptance:** T06, T10-T12, R05, R06; unknown dates stay Insufficient information; an explanation is a recorded assertion, never proof; old snapshots unchanged; both sides of a comparison are authorized.

---

## WP-X1 Case journey view

**Class** P. **Branch** `claude/prog-x1-case`. **Depends on** C1. **Preview** approved (case journey, two states). **Owner gates** wording of the reminder line.

**Head start (verify).** `apps/web/src/app/app/mission/[id]/page.tsx` (about 1,056 lines) already has: `CaseStageTracker` using `STATE_LABELS` and next states, a notice when `isDirty` (changed since last acknowledged, snapshot invalidated), an attention list (`case-attention`) with counts and links, collapsed `Disclosure` sections, and a header showing whether the applicant has confirmed. Only `layout.test.tsx` exists beside it.

**Steps.** (1) Write a characterization test of today's page and make it pass before any edit. (2) Add a `NextStepCard` under the stage tracker built from the first item of the existing `attention` list, in its existing order. If the list is empty keep the existing success badge and render no card. (3) Move the existing `isDirty` notice directly under the tracker, styled as the approved alert, keeping its text and its existing snapshot button. (4) Document anchors for later blocks: triage summary (V4) goes directly under the next step card, and the changed-fields view (V3) inside the alert. Add no placeholder elements. (5) Use the real `STATE_LABELS`, not the preview's sample stage names.

**Held out until the owner approves wording:** a line saying prepared is not submitted and there are no approval odds. Held out until V3: the list of changed fields.

**Allowlist seed:** `apps/web/src/app/app/mission/[id]/page.tsx`, `apps/web/src/app/app/mission/[id]/page.test.tsx` (new), `apps/web/src/app/globals.css` (WP-X1 block only).

**Acceptance:** characterization test unchanged in outcome; every control that existed still exists; section order below the new card unchanged; next step visible without scrolling at 390px; X02, X04, X06 evidence; `layout.test.tsx` passes unchanged.

**Forbidden:** acknowledgement and `isDirty` logic, snapshot creation, evidence selection, submission and outcome, permissions, routes.

---

## WP-X2 Grant review brief

**Class** P, plus one sentence of new copy. **Branch** `claude/prog-x2-brief`. **Depends on** C1. **Preview** approved. **Owner gates** wording of the download sentence.

**Head start (verify).** In `apps/web/src/app/app/applicant/[id]/sharing/grant-form.tsx` the person enters recipient email and purpose, picks permissions (Preview is on by default), picks profile parts and documents, optionally sets `expiryDays`, then sees "Your access summary" and, after review, "Confirm this access". The server action `createGrantAction` reads the same native fields. Grants store `expiryAt`. Existing tests: `grant-form.test.tsx`, `page.test.tsx`, `actions.test.ts`. The form accepts an email, not an organisation, so the brief shows no "Verified organisation".

**Steps.** (1) Build a presentational `SelectedScopeSummary` (new component) taking plain props: recipient, purpose, permissions in plain words, profile scope, document scope, end date or none. WP-V5 reuses it. (2) Re-lay the review panel with it: Who, For, They can, Can see, Can open, Ends on [date] or "No end date" in warning tone, "Everything you did not select stays private". Whole profile and every document also use warning tone. (3) Show the same rows on active grant cards in `page.tsx`. Pause and Revoke unchanged. (4) Only when the Download permission is selected, show the sentence the owner approves, proposed as: "Revoking ends access on VisaStack. It cannot take back copies someone already downloaded." (5) Leave the pending invitation block untouched until WP-V1 has merged.

**Tests.** Existing three test files pass unchanged. New: summary shows recipient, purpose, permissions and scopes exactly as selected; the form data posted to `createGrantAction` is identical before and after for narrow, whole-profile and every-document cases; warning tone for broad scope and for no end date; the download sentence appears only with Download selected; review is still required before confirm.

**Allowlist seed:** `apps/web/src/app/app/applicant/[id]/sharing/grant-form.tsx`, `apps/web/src/app/app/applicant/[id]/sharing/grant-form.test.tsx`, `apps/web/src/app/app/applicant/[id]/sharing/page.tsx`, `apps/web/src/app/app/applicant/[id]/sharing/page.test.tsx`, `apps/web/src/components/selected-scope-summary.tsx` (new) and its test (new), `apps/web/src/app/globals.css` (WP-X2 block).

**Forbidden:** `createGrantAction`, pause, resume, revoke, scope expansion, grant lifecycle, services, permissions, defaults.

**Acceptance:** X05, X02, X04 evidence; the identical-form-data test is the guard against over-sharing.

---

## WP-X3 Context chip in the top bar

**Class** P. **Branch** `claude/prog-x3-chip`. **Depends on** C1.

**Head start (verify).** The context selector already exists as `WorkspaceSelector` in `apps/web/src/app/app/workspace-shell.tsx`, listing personal space, managed travellers, agencies and platform operations. On a phone it sits inside the More panel (`.app-mobile-identity` in `app-nav.tsx`), so who you are acting as is hidden by default. `workspaceNavigation()` in `apps/web/src/lib/workspace-navigation.ts` is a pure function that grants no access.

**Steps.** Show a compact version of the existing selector in the mobile top bar, reading from the same data, with the same keyboard behaviour (Escape closes and returns focus). Do not change `workspaceNavigation()` or access computation. Add `app-nav.test.tsx` (new): the bar still shows four links, More opens the rest, the chip is visible without opening More, a user with no traveller access still gets an empty list.

**Allowlist seed:** `apps/web/src/app/app/app-nav.tsx`, `apps/web/src/app/app/app-nav.test.tsx` (new), `apps/web/src/app/app/workspace-shell.tsx`, `apps/web/src/app/app/workspace-record-toolbar.tsx`, `apps/web/src/app/globals.css` (WP-X3 block).

**Acceptance:** chip visible at 360 and 390px; no route, permission or access change; X06, X08 evidence.

---

## WP-V3 v1.2 PR2/S3: Personal Record, Application Memory, prior versus current, four-tab shell, task-first first run

**Class** B. **Branch** `claude/prog-v3-record`. **Depends on** V1, V2, P0, X3. **Spec** v1.2 PR2/S3, B03 (U01), B08 (U06), E01, E03 UI, tests T01, T07, T10-T12, R01, R02, R05, R06. **Owner gates** D7, D8, the revised first-run preview.

**Head start (verify).**

- Home is `apps/web/src/app/app/page.tsx`. It already computes one next step in priority order (consent gate first) with `NextStepCard` and a "Set up your account" `Checklist`. Consent and applicant creation are separate server actions (`setConsentAction`, `createApplicantAction` in `apps/web/src/app/app/actions.ts`), six consent types exist, and no test covers `/app` today.
- Navigation: `apps/web/src/lib/workspace-navigation.ts` (with test) currently gives travellers Overview, My profile, Documents, Visa cases, Sharing, Notifications, Countries, with tools Shared with me, Account overview, Evidence requests, Dates and expiry, History. The phone bar shows the first four (`BAR_LINKS = 4` in `app-nav.tsx`).
- `apps/web/src/lib/profile-fields.ts` exists. `apps/web/src/lib/profile-sections.ts` named by v1.2 does not exist at this SHA; the W0 ledger must find where sections live now.

**Scope.**

1. Four-tab shell: Home, Record, Cases, Sharing, then Notifications and Countries under More. Record is the Personal Record hub (U01 groups, metadata search and filters, actions View, Update or Replace, Use in case, Share). Documents, Dates and expiry and History become sections of Record. Rename the tool "Account overview" to "Account and permissions". No route removed (`check-route-navigation.mjs` must pass). Write a before and after link list into the PR.
2. Task-first first run (D8). Screen 1: Allow core processing using the existing `ConsentButton` with an optional label prop; it renders one consent only and says AI reading, sharing and marketing stay off. Screen 2: your name using the existing `AddApplicantForm`, presented as Me or Someone I manage; choosing Someone I manage reveals Family member or Minor (guardian) and the authority confirmation, values unchanged. Screen 3: "What do you want to do?" showing only choices whose destination has shipped: Complete a request (when one is pending) and Update or find my records. "Prepare a brief" is added by WP-V5. Skip is always possible. If a validated `next` return path exists, finish screens 1 and 2 then go to that task and skip screen 3. First run renders only when core processing is not granted or no applicant exists; otherwise Home renders as today. Write the `/app` characterization test first.
3. Application Memory (U06) and the prior-versus-current view (E03): exact selected versions, effective and as-of dates, classification vocabulary, explanation recorded as assertion, resolution through existing review mechanisms. Show the changed-fields list inside the WP-X1 alert.
4. Colour only for all other screens.

**Tests.** T01, T07, T10-T12, R01, R02, R05, R06. UX: `/app` characterization test before edit; first-run renders exactly one consent control; consent-button and actions tests unchanged; nav before and after link list; no route lost; first-run is skipped when a valid `next` exists; the first-run component does not render for users who already have consent and an applicant.

**Allowlist seed.** Final list comes from the W0 ledger. Likely: `apps/web/src/lib/workspace-navigation.ts` and test, `apps/web/src/app/app/app-nav.tsx`, `apps/web/src/app/app/workspace-shell.tsx`, `apps/web/src/app/app/page.tsx`, `apps/web/src/app/app/page.test.tsx` (new), `apps/web/src/app/app/first-run.tsx` (new) and test, `apps/web/src/app/app/consent-button.tsx`, `apps/web/src/app/app/add-applicant-form.tsx`, `apps/web/src/app/app/applicant/[id]/**`, `apps/web/src/lib/profile-fields.ts`, services files named by the ledger, `apps/web/src/app/globals.css` (WP-V3 block).

**Forbidden:** goal or destination prompts, guest staging, parallel account claim, new auth, consent semantics, a full-profile gate, WhatsApp, Bangla.

**Acceptance:** the useful-partial-profile journey works with no passport, goal or payment; X03 shows at most two setup screens; X04 and X05 evidence; ledger rows complete.

---

## WP-V4 v1.2 PR2/S4: reuse, Needs Attention, resumable requests, agency triage, Do next

**Class** B. **Branch** `claude/prog-v4-journey`. **Depends on** V3, X1. **Spec** v1.2 PR2/S4, B04 (U02), B05 (U03), B09 (U07 request UX), E01, E02, tests T02, T05-T09, T13, R03, R04. **Owner gates** the Do next ranking order and any change to who can see evidence requests.

**Head start (verify).**

- `apps/web/src/app/app/agency/[orgId]/page.tsx` (about 628 lines) shows pipeline, inbox, quick views (Mine, Overdue, Waiting On Traveller, Unassigned via a `quick` URL parameter) and a case table with a Deadline column. Helpers `summarizeAttention`, `countOverdueTasks`, `nextApproachingDate` live in `console-format.ts` with tests; `console-data.ts` and `page.test.tsx` exist.
- Evidence requests carry `kind`, `docType`, `message`, `dueDate`, `status` and `createdAt`. `listEvidenceRequestsForOrg` returns them to organisation owners and admins only, so non-admin workers see none. Do not widen this. If v1.2 needs non-admin reviewers to see items for their assigned cases, that is a permission change: stop and ask.
- A Needs Attention aggregation and ICS export already have seams: `notification-sweep.ts`, `expiry.ts`, `apps/web/src/lib/ics.ts`, a mission appointment ICS route.

**Scope.**

1. U02 Prepare again with three groups, Reusable, Needs refreshing or review, Missing, copying references only (never approvals, grants, notes, outcomes).
2. U03 Needs Attention as one authorized read projection with direct actions; Home composition per B13: My Records, Needs Attention, Active Requests and Work first, My Next Journey supporting, at most about half of initial desktop content; mobile shows actionable items first. Home may reuse this projection for the Home next-action card.
3. U07 request UX: statuses and guidance per item, accurate Saving, Saved at, Not saved states, item-level clarification using existing task or comment mechanisms.
4. E02 triage: summary groups per PROGRAMME section 8, mapped from existing statuses, one primary status plus separate indicators. Reviewed item guidance and presets use existing configuration; no new catalogue; guidance never teaches fabrication.
5. Agency Do next: a list built only from the E02 mapping and from data the signed-in person already loads. Proposed ranking, needing owner approval: open items past due (oldest due first); items received and waiting for review; cases with overdue tasks (most overdue first); cases with no assignee (administrators only). Ties by oldest created, then title, so order is stable. Show each item with owner, reason and one action. A copy-ready follow-up message is built from the request's own fields (the agency's own `message` is used as body if present), contains no ids, links with tokens, document numbers or email addresses, is shown for review, and is never sent by the product. Clipboard denied shows selectable text. Add an ADR from `docs/adr/0000-template.md` recording the ranking rule.
6. Colour only elsewhere.

**Tests.** T02, T05-T09, T13, R03, R04. UX: ranking tiers, tie-breaks and determinism; a non-admin gets no request items and no error; message builder contains no uuid, URL or email and no em dash; copy button announces Copied through a live region; existing `page.test.tsx`, `console-data.test.ts`, `console-format.test.ts` pass unchanged apart from added cases.

**Allowlist seed.** From the W0 ledger. Likely: `packages/services/src/missions.ts`, `packs.ts`, `agency.ts`, `notification-sweep.ts` (only where the ledger proves a change), `apps/web/src/app/app/agency/[orgId]/**`, `apps/web/src/app/app/applicant/[id]/**`, `apps/web/src/app/app/page.tsx`, `apps/web/src/lib/ics.ts`, `docs/adr/` (new ADR), `apps/web/src/app/globals.css` (WP-V4 block).

**Acceptance:** X09, X10, X11 evidence with baseline and after; no item shown for a case the person cannot already see; nothing is sent by the product.

---

## WP-V5 v1.2 PR3/S5: selected output service and four outputs

**Class** B. **Branch** `claude/prog-v5-outputs`. **Depends on** V4, X2. **Spec** v1.2 PR3/S5, B10 (U08), B11 (U09), B12 (U10), E04, E01 output, tests T14-T16, R07, R08. **Owner gates** the wording of each output's labels.

**Head start (verify).** `packages/services/src/export.ts` (333 lines) and `export-csv.ts` (131 lines) are broad account exports. Never filter a full-account response in the UI. Build one server-authorized selected-output projection carrying selected immutable versions, source and as-of context, purpose and unknowns, then four thin templates: agency brief and handover, trip essentials, AI context, confirmed-information sheet. Reuse `SelectedScopeSummary` from WP-X2 for the preview.

**Also.** Add the third first-run choice, "Prepare a brief" (E01), now that its destination exists. WhatsApp share is a prepared generic message plus a secure workspace or invitation link, never a document, identifier or preview of one, never sent automatically.

**Acceptance:** T14-T16, R07, R08; preview and export match exact selected versions; unselected values and private notes are absent in the server response, not just hidden; defaults minimal; identifiers excluded unless deliberately included with the existing reveal and assurance; clipboard fallback works; no storage URLs or raw tokens in output; expired or revoked access denies future retrieval.

---

## WP-V6 v1.2 PR3/S6: full acceptance, landing truth refresh, scorecard, release reconciliation

**Class** R and P. **Branch** `claude/prog-v6-acceptance`. **Depends on** V5.

**Steps.** (1) Run T01-T16 and R01-R08 against the exact final commit on staging with synthetic accounts. (2) Complete the ledger with exact commands, outcomes and tested commit. (3) Landing refresh (L2): re-verify every claim row; if Prepare again and compare-versions have shipped, restore the C1 float "Prepared again, faster" and the full card 1 text, otherwise keep the shorter text. Change nothing else on the landing. (4) Fill the scorecard X01-X14 with baseline and after values; any measure that got worse is reported and blocks. (5) Release reconciliation: list live limitations accurately (real-data block, scanner, MFA, recovery acceptance as recorded). (6) The final release-candidate PR must not be merged or deployed without the owner's explicit instruction after reading the final report.

**Allowlist seed:** `apps/web/src/app/page.tsx` and its test (landing copy only), `docs/upgrades/**`, test files.

**Acceptance:** the programme definition of done in `PROGRAMME.md` section 13.
