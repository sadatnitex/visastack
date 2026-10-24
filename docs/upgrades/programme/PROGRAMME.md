# VisaStack Programme X: UX/UI upgrade plus upgrade.v1.2, one combined plan

Prepared: 24 October 2026 (Asia/Dhaka).
Repository reference: `main` at `84cc84e` (15 October 2026), inspected read-only. Re-verify the current SHA in WP-A0.
Status of this document: FINAL for owner approval. Nothing in it has been built, pushed, merged or deployed.

This file is the single master contract. It binds three sources together:

1. `docs/upgrades/upgrade.v1.2.execution.md` (functional and security requirements U01-U10, E01-E04, T01-T16, R01-R08). Unchanged. Referred to as "v1.2".
2. The Harbor Blue v2 package, placed at `docs/design/harbor-v2/` (landing page R01 frozen, palette, adoption gates A-F). Referred to as "Harbor".
3. The UX layer defined here and in `WORK-PACKAGES.md` (landing first, information architecture, journeys, screens).

Read order for any session: `STATUS.md`, then the assigned work package in `WORK-PACKAGES.md`, then only the sections of this file it points to.

---

## 1. Outcome in one paragraph

VisaStack is a traveller-controlled reusable mobility record that serves travellers and agencies together. The loop is: receive a clear request, supply or reuse information, resolve specific gaps, produce a selected useful output, keep an accurate record for the next task. The experience must feel effortless on a mid-range Android phone, be honest about what is saved, shared, reviewed and unknown, give people a reason to return that is real (a request, an expiry, a change), and give agencies a faster way to run cases. Every claim on every screen must be true of the deployed product.

No tenfold claim, approval prediction, certification, zero-risk claim, fake metric, fake testimonial or fake partner is introduced anywhere.

---

## 2. Authority ladder (highest wins)

| Rank | Source | Governs |
| --- | --- | --- |
| 1 | Safety, privacy and security invariants (`CLAUDE.md` section 4, v1.2 Appendix B) and the owner's latest explicit decision in this programme (section 4) | Everything |
| 2 | `CLAUDE.md` standing rules, except where section 3 of this file narrows them for this programme | How sessions run, CI, costs, wording rules |
| 3 | v1.2 | What the product does: behaviour, security, data, tests |
| 4 | Harbor | How the landing page looks and which colours the product uses |
| 5 | This UX layer | How the experience is organised: navigation, journeys, screens, states |

Rules:

- A lower source never overrides a higher one. Where a lower source and a higher source differ, follow the higher one and record it in the ledger.
- If two sources conflict and the conflict register (section 3) does not cover it, STOP and report the conflict to the owner. Never choose silently. Never reconcile by inventing a compromise design.
- Historical observations in v1.2 section 4 are starting points, not facts. Verify against current code before relying on them.

---

## 3. Conflict register (already found and resolved)

| ID | Conflict | Resolution | Basis |
| --- | --- | --- | --- |
| CR01 | v1.2 says "preserve approved navigation, no dashboard redesign, no broad design expansion". The UX layer regroups navigation and changes colours | The owner-approved UX work packages listed in section 7 override that line for those packages only. Nothing else in the product is redesigned | D7 |
| CR02 | UX first-run asked people to choose a purpose and destination. v1.2 E01 and B13 say do not force a goal and keep goal planning supporting | E01 wins. First run is task-first (section WP-V3). No purpose or destination prefill. No Guest-first Preview | D8 |
| CR03 | Harbor landing uses system font and weight 820. The app keeps Inter | Landing follows the frozen Harbor type stack. App and auth keep Inter with Harbor colours. Recorded as an owner exception to Harbor's "never Inter" rule | D2 |
| CR04 | Harbor app-extension proposal uses 40px buttons. The product floor is 44px | 44px stays. The 40px proposal is not adopted | Existing baseline, X06 |
| CR05 | `CLAUDE.md` says draft PR, ready, then squash merge when a segment is done. `docs/uiux/CHANGE-SAFETY.md` rule 6 says nothing merges without the owner's word | For every PR in this programme the owner's explicit merge word is required. This narrows the standing rule for this programme only | D6 |
| CR06 | `CHANGE-SAFETY.md` rule 1 says interface changes are presentation only. Some packages add logic | Every package is classed P (presentation) or B (behaviour). B packages carry their own owner approval and their own PR | Section 7 |
| CR07 | Harbor says no new marketing sections. The live landing carries honest availability, audience, trust and roadmap content | Existing content that Harbor does not depict is preserved with Harbor colours only (`EXISTING-PRESERVED`). Nothing is added | WP-L1 |
| CR08 | Harbor C1 uses shadows, gradients and floating cards. `scripts/check-flat-design.mjs` (part of `pnpm run lint`) and `docs/uiux/DESIGN-CONTRACT.md` forbid shadows, gradients, blur and floating cards | Owner decision D1 decides. Until D1 is answered, WP-L1 may not write production landing code | D1 |
| CR09 | Harbor mobile source has no navigation links, overlapping floats and a 768px overflow | Corrected as signed extensions with before and after screenshots | D4 |
| CR10 | v1.2 says legacy provider code is not removed incidentally. The owner decided WorkOS is retired | Removal happens only inside WP-P0, with its own approved brief, never incidentally | D10 |
| CR11 | Earlier UX idea of an in-app feedback table stores user-written text. v1.2 allows only metadata-only instrumentation | Held out of this programme until the owner decides | D11 |
| CR12 | Earlier UX idea of a separate Do next ranking. v1.2 forbids a second case state machine | Do next is built on the E02 state mapping after WP-V4, never on its own vocabulary | WP-V4 |

---

## 4. Owner decisions

All eleven decisions were answered "all recommended" by the owner on 24 October 2026. Any decision later reopened is marked OPEN, and the coding agent must treat OPEN as a stop for the packages it blocks, and continue with the others.

| ID | Decision | Recommended answer | Blocks | Status |
| --- | --- | --- | --- | --- |
| D1 | Landing page visual effects. Harbor C1 needs shadows, gradients and floating notification cards, which the repo's flat-design guard forbids. Choose: (a) a scoped, documented exception for the public landing only, in its own stylesheet, with the guard still enforced everywhere else; (b) flat equivalents of every effect, which needs a signed geometry exception and loses some of the approved look; (c) hold the landing | (a) | WP-L1 code | APPROVED 24 Oct 2026 (recommended answer) |
| D2 | Fonts: landing uses the frozen Harbor system font stack. Product screens keep Inter | Accept the split now. Revisit after the app extension is approved | none | APPROVED 24 Oct 2026 (recommended answer) |
| D3 | Landing navigation destinations: Product goes to `#product`, For agencies to `#for-agencies`, Privacy and control to `/trust`, How it works to `#how-it-works`. All already exist | Yes | WP-L1 | APPROVED 24 Oct 2026 (recommended answer) |
| D4 | Signed landing corrections: 768px overflow fix, floats that hide hero text at 390 and 360px, caption overlap, and a mobile menu (reusing the existing `SiteNavigation`) so phone users can reach those links | Yes | WP-L1 | APPROVED 24 Oct 2026 (recommended answer) |
| D5 | Truthful illustrative content: change the phone's bottom tab label from Documents to Record, and replace the float "Prepared again, faster" until Prepare again (U02) ships | Yes | WP-L1 | APPROVED 24 Oct 2026 (recommended answer) |
| D6 | Owner merge word required on every PR in this programme | Yes | all | APPROVED 24 Oct 2026 (recommended answer) |
| D7 | UX packages override the v1.2 "preserve navigation, no dashboard redesign" lines for the listed packages only | Yes | WP-C1 onward | APPROVED 24 Oct 2026 (recommended answer) |
| D8 | First run is task-first: Allow core processing, your name, then "What do you want to do?" showing only choices whose destination has shipped: complete an agency request and update or find my records at first, and "prepare a brief" once the output service ships (WP-V5) | Yes | WP-V3 | APPROVED 24 Oct 2026. The revised first-run preview still needs the owner's explicit approval before WP-V3 starts |
| D9 | Colour layer ships as one global token PR with evidence for every route family, not family by family (the stylesheet is global, so splitting would duplicate it) | Yes | WP-C1 | APPROVED 24 Oct 2026 (recommended answer) |
| D10 | WorkOS retirement as its own package with its own approved brief, gated on Neon Auth journeys passing on staging | Yes | WP-P0 | APPROVED 24 Oct 2026 (recommended answer) |
| D11 | Hold the feedback capture table. Drop the Guest-first Preview. Chart colour palette is a later proposal | Yes | none | APPROVED 24 Oct 2026 (recommended answer) |

Package-level approvals (wording, ranking, tints) are listed inside each work package.

---

## 5. Objectives and the UX scorecard

The owner's objective: an experience that feels like a top global product, is intuitive and effortless for Bangladeshi citizens at home and abroad, builds trust, brings people back and gets recommended, and makes agencies faster, while keeping reusable infrastructure, security, permissions and commercial ambition, at low implementation cost.

"Win" is defined by measured evidence, not adjectives. WP-A0 captures a baseline for every measure below. WP-V6 records the final values. A claim of improvement without a baseline and an after value is not accepted.

| ID | Objective | Pass condition | Proof | Moved by |
| --- | --- | --- | --- | --- |
| X01 | Instant clarity on the landing page | At 360x640 the headline, one primary action and the honest availability status are visible without scrolling. No horizontal scroll from 320 to 1440 | Playwright screenshots and assertions | L1 |
| X02 | One clear primary action | Each changed screen has one primary-styled action per decision point | Component tests plus reviewer check | L1, X1-X3, V3-V5 |
| X03 | Fewer steps to the first useful task | Baseline measured in A0. After: at most two setup screens between confirmed email and the first task screen | Playwright step counter | V1, V3 |
| X04 | Honest states | Every save, upload and request action shows Saving, Saved at [time] or Not saved with retry. Empty, processing, rejected, expired, revoked, denied and offline-retry states exist | State matrix per package | all B and P packages |
| X05 | Scope clear before sharing | Preview shows recipient, purpose, selected items with versions, end date (or "No end date" in warning tone), what stays private, and the revoke limit when download is allowed | Tests in X2 and V5 | X2, V5 |
| X06 | Phone first | Works at 360 and 390px, 44px minimum targets, no horizontal overflow, usable on a throttled slow network | Playwright viewports plus manual real-device pass | all UI |
| X07 | Plain and truthful language | Claim register fully verified. `apps/web/src/lib/plain-language.test.ts` passes. No engineering words, no invented claims | Claim register in the ledger | L1, L2, all copy |
| X08 | Accessible | WCAG 2.2 AA: contrast, keyboard path, focus, reduced motion, screen-reader pass on changed blocks, usable at 200 percent zoom | Contrast test, keyboard test, manual notes. Use the repo's existing accessibility tooling; if none exists, say it is manual | all UI |
| X09 | Information entered once is reused | Prepare again starts a case without retyping unchanged confirmed facts | T09, U02 tests | V4 |
| X10 | Agency efficiency | The top three actions on a case list are findable without opening a case. Task timing on staging, baseline against after | Timed synthetic task | V4 |
| X11 | Real reasons to return | Expiry, request, change and invitation each produce exactly one deduplicated attention item with a direct action | T13 | V4 |
| X12 | Purposeful polish | Motion only for state change. Reduced motion respected. No fake counters, testimonials or partner logos | Review plus claim register | L1, all UI |
| X13 | Performance does not regress | Baseline for landing and Home in A0 with one lab method. After must not be worse. Landing target: LCP at most 2.5 seconds on a throttled mid-range mobile lab profile. This is a target to measure, not a guarantee | Same lab method before and after | L1, V3, V4 |
| X14 | Low cost to build and run | No new dependency, provider, table or queue unless the W0 ledger proves it is needed and the owner approves. Each package reports lines changed and dependency delta | PR report | all |

### Anti-goals (never build, never imply)

Approval odds or scores, a universal profile percentage, a single "Verified" badge, AI as a required step, fake dashboards or counters, a second state machine, guest staging subsystems, WhatsApp sending, a browser extension, payments, Bangla translation, native apps, offline caches of sensitive data, and everything in the v1.2 exclusion list (v1.2 section 10).

---

## 6. Scope

In scope: landing page (R01), Harbor colour layer, WorkOS retirement, all ten v1.2 upgrades with E01-E04, and these UX changes: context chip, four-tab navigation (Home, Record, Cases, Sharing), task-first first run, case journey view, grant review brief, agency Do next on top of E02, and the landing truth refresh.

Out of scope: everything in the anti-goals, public pages R02-R04 redesign (need their own approved visuals), app screens with no approved visual beyond colour, and any Harbor app-extension geometry.

---

## 7. Work packages and order

Full briefs: `WORK-PACKAGES.md`. Class P is presentation only. Class B changes behaviour. Class R is read-only.

| Order | ID | Package | Class | Depends on | Owner gates |
| --- | --- | --- | --- | --- | --- |
| 1 | WP-A0 | Read-only audit, baselines, Harbor lock, allowlists, drift guard | R, docs and scripts only | none | D6, D7 |
| 2 | WP-L1 | Landing page R01 conversion | P | A0 | D1, D2, D3, D4, D5, landing preview approval |
| 3 | WP-C1 | Harbor colour layer for the whole product except the landing | P | L1 | D9, derived tints, dark-surface colours |
| 4 | WP-P0 | WorkOS retirement | B | C1 | D10, approved brief |
| 5 | WP-V1 | v1.2 PR1/S1: invitation identity, neutral preview, return path | B | P0 | none beyond D6 |
| 6 | WP-V2 | v1.2 PR1/S2: version and time semantics, change impact, consistency foundation | B | V1 | none beyond D6 |
| 7 | WP-X1 | Case journey view | P | C1 | previews approved |
| 8 | WP-X2 | Grant review brief | P | C1 | download wording |
| 9 | WP-X3 | Context chip in the top bar | P | C1 | none |
| 10 | WP-V3 | v1.2 PR2/S3: Personal Record, Application Memory, prior versus current, four-tab shell, task-first first run | B | V1, V2, P0, X3, D8 | D7, D8, revised first-run preview |
| 11 | WP-V4 | v1.2 PR2/S4: reuse, Needs Attention, resumable requests, agency triage, Do next | B | V3, X1 | ranking order |
| 12 | WP-V5 | v1.2 PR3/S5: selected output service and four outputs | B | V4, X2 | wording per output |
| 13 | WP-V6 | v1.2 PR3/S6: full acceptance, landing truth refresh (L2), scorecard, release reconciliation | R and P | V5 | final review |

Allowed parallel pairs (separate worktrees, one writer each, disjoint allowlists): X1 with V1 or V2, X2 with V2, X3 with V2. Everything else is sequential.

### Merge and PR policy

- One work package equals one PR (V-packages follow v1.2 sessions and PRs; PR boundaries stay as v1.2 section 6 defines).
- Branch names are designated per package in `WORK-PACKAGES.md` (pattern `claude/prog-<id>`). Never push anywhere else.
- Draft PR first. Ready only when every gate in section 10 is met. The owner's explicit merge word is required (D6). Never merge, deploy, run a production migration or activate sensitive-data intake without it.

---

## 8. Truth rules and state vocabulary

One vocabulary for the whole product. Reuse existing labels from `apps/web/src/lib/labels.ts`. Stand-alone labels use Title Case. Inside a sentence, lower case.

| Never conflate | Rule |
| --- | --- |
| Received and Reviewed | A received item is not reviewed |
| Current version and Valid everywhere | A current version is not proof of authenticity or suitability |
| Saved and Shared | Saved is not shared unless disclosed |
| Prepared, Approved and Submitted | Approved or downloaded is not submitted. Use the existing recorded-submission meaning |
| Suggested and Confirmed | A suggestion is not confirmed |
| Unknown and None | Unknown, withheld and missing dates stay unknown. Never guess, never imply "none" |

Agency triage groups (E02): Missing; Processing; Received or awaiting confirmation; Needs correction or clarification; Reviewed; Ready for review. Map existing statuses in the W0 ledger. Do not create a second state machine.

Consistency results (E03): Consistent; Legitimate change; Context difference; Needs clarification; Insufficient information.

Forbidden labels and claims: "Verified" as one badge, "Certified copy", "Verified booking", "Boarding pass", "Guaranteed entry", any approval likelihood, "100 percent secure", unmeasured numbers, endorsements.

Every statement on the landing and in new copy must appear in the claim register (ledger rows `CL-*`) with a file and symbol that proves it. A claim about a feature that has not shipped is not allowed until it ships.

---

## 9. Landing page first (rules in brief)

The landing page (Harbor R01) is the first production change. It is its own PR, changes no other route, and follows Harbor's landing rules plus the signed corrections in D4 and D5. Full brief: WP-L1. The landing is refreshed again at the end (WP-V6, L2) so its copy matches what has shipped.

---

## 10. Verification gates (every PR)

| Gate | What must be true | Evidence in the PR |
| --- | --- | --- |
| G1 CI | `Lint · Build · Typecheck · Test`, `No-secret Playwright checks`, `No-secret smoke check` green on the exact head SHA. Local: lint, typecheck, test, web Vitest, web build, `pnpm audit --prod --audit-level high` | Check-run summary for the head SHA |
| G2 Change safety | `docs/uiux/CHANGE-SAFETY.md` rules 1-6. Ratchet counters did not rise. Flat-design guard passes (with the approved D1 exception only for the landing stylesheet). Route and link check passes. Plain-language test (`apps/web/src/lib/plain-language.test.ts`) passes | Command output summary |
| G3 Harbor | For the landing and colour packages: Harbor gates A-F, four viewports 1440, 1024, 768, 390, plus 360. Every CSS change labelled `C1-FROZEN`, `HARBOR-COLOR`, `EXISTING-PRESERVED`, `OWNER-EXTENSION`, `A11Y-EXCEPTION` or `FUNCTIONAL-EXCEPTION`. Unlabelled CSS blocks the PR | Change-classification table |
| G4 v1.2 | The T and R tests assigned to the package pass against real services and routes, not mocks. Security negatives included | Ledger rows with exact command and outcome |
| G5 Scorecard | Every X measure the package claims to move has an after value beside its baseline | Scorecard table |
| G6 Drift | `node scripts/programme/check-allowed-paths.mjs <allowlist>` exits 0. PR ends with "What I did not touch" covering routes, actions, permissions, consent, data model | Script output |
| G7 Owner | The approvals listed for the package are recorded, with date | Approval list |

PR report format (plain language, as `CLAUDE.md` requires): a table with Area, What changed, What you will see, Who notices. Then: Checked live, Not live yet, Not yet checked, Needs you. End with what was done and one concrete next step. No em dashes anywhere.

---

## 11. Drift prevention

1. **Allowlist.** Each package has `docs/upgrades/programme/allowlists/<WP>.txt`. It is the first commit of the package branch. Any file outside it needs the owner's approval first. `check-allowed-paths.mjs` enforces it.
2. **One session, one package.** Stop at the package boundary. Do not start the next package, do not do "while I am here" fixes, do not implement anything in the exclusion lists.
3. **One writer per worktree.** No parallel agents on the same scope. No subagents (`CLAUDE.md` section 5).
4. **Read narrowly.** `rg` for symbols, then bounded ranges. Never dump large files, logs, lockfiles or snapshots into context.
5. **Preview before build.** Any new or changed screen has an owner-approved preview (`previews/approved-previews.html` or the landing preview from WP-A0) before code. Screens not previewed get colour only.
6. **Stop conditions.** Stop and report if: the repo head differs from the ledger in a way that changes the package, an authorization boundary is unclear, a historical v1.2 observation turns out false, a Harbor hash or token check fails, copy would claim something unverified, an allowlist file is insufficient, a required check cannot pass without disabling a test, or two sources conflict outside the register.
7. **Never** skip, disable, quarantine or waive a test. A failing test is never a flake. Never claim green without checking each required check on the current head SHA.
8. **Status file.** After each package update `STATUS.md` (250-400 words) and the ledger rows it touches. The status file and the ledger are the memory between sessions. Do not paste whole prior conversations.
9. **Ledger honesty.** A requirement is "done" only with the exact command, outcome and tested commit in the ledger. A component or a mocked test alone is not done.
10. **CSS convention.** New styles go in a delimited block at the end of `globals.css`: `/* WP-<id> begin */ ... /* WP-<id> end */`, using Harbor tokens. No inline styles (the ratchet forbids raising them). The landing stylesheet is separate (WP-L1).

---

## 12. Release and operations constraints

- Production is a controlled pilot with public beta registration open for synthetic data. Real applicant data stays blocked until the owner lifts it. Nothing in this programme activates sensitive-data intake, public-data claims or commercial launch.
- No package may break `/auth/sign-up`, `/auth/sign-in`, `/privacy`, `/terms`, `/status` or `/trust`. Check them in every PR.
- No migration unless the W0 ledger proves no existing structure fits and the owner approves. Production migrations need explicit owner approval per run.
- Founding Access stays complimentary. No paywall, profile-completion gate or usage-marketing gate.
- Agency access to a traveller's next case is never automatic. Revocation never promises recall of copies already exported.

---

## 13. Definition of done (programme)

The programme is complete only when all of the following hold:

1. All thirteen work packages are merged with the owner's word, each with its gates met.
2. All ten v1.2 upgrades and E01-E04 map to working code and evidence; T01-T16 and R01-R08 pass against the exact final commit; identity, selected access, temporal truth and frozen history are correct.
3. The landing page matches Harbor R01 with the signed corrections, and every claim on it is verified at the final commit.
4. The scorecard X01-X14 has a baseline and an after value, and no measure got worse.
5. Live limitations are disclosed accurately. Done never means a mock, a green build or a user count.
