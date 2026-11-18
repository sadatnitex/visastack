# Session handoff, 18 November 2026

Supersedes `SESSION-HANDOFF-2026-11-09.md` for current state (older handoffs stay as history). Read `CLAUDE.md`, `docs/SESSION-START.md` (section 7 is current), then this file. What is live per unit: `docs/public-beta/CURRENT-STATE.md`, update of 2026-11-18.

## 1. Session roles (conductor skill, owner 16 Nov 2026)

| Role | Session | Does |
|---|---|---|
| Orchestrator (Sonnet) | `session_0187kU9sBuhsVeuhzqocEJDy` | Only door to the owner; relays packets and results |
| Guardian 13 (Opus or higher) | `session_0187kU9roBxzsua6trPgkQo9` | Plans, launches builders, reviews, Merge Gate, merge queue, deploy, records |
| Builders | one session per unit | One unit, one branch, one PR; send ACK, BLOCKED, DECISION, RED, DONE to the Guardian |

Rules and message formats: `.claude/skills/conductor/SKILL.md`. At most 6 builders at once (orchestrator, 18 Nov).

## 2. Live lanes

| Lane | Branch | State |
|---|---|---|
| MOT1 motion for every visitor | `claude/mot1-phone-motion` | Merged as #651 (`769e43ea`), deploy being verified by the Guardian; archive the branch after |
| NAV2 public header and footer | `claude/nav2-header-footer` | Running, no PR yet |
| PUB5 public-site verification | `claude/pub5-public-site-verification` | Idle; a second pass is due after NAV2 and MOT1 |
| PR #581 Bengali refill 7 | `claude/magical-curie-3p4qcx-refill-7` | Draft, stale, needs a refresh from main |
| DOC1 (this sync) | `claude/doc1-docs-sync-2026-11-18` | Docs only |

Main is `769e43ea` (MOT1 #651, deploy being verified); U7 #650 `00c01849` deploy verified. Next free migration number: 0138.

## 3. Owner decisions (17 and 18 Nov; full list in SESSION-START section 6)

- Wallet choices: Profile "B Passport Page Card"; Document detail A+B; Trip Package "-A"; AI Connections "- A"; tab name "My Record".
- Working rules: "dont bother about real/madeup data"; "run parrallel sessions as per rules to finish asap"; bundles allowed ("yes, but without not pushing others for reruns"); "stop wasting time, and tokens by mis-coordination".
- Review model: page rebuilds on Sonnet; Class B one Sonnet review; single Opus review for documents and personal-data presentation; two Opus reviewers only for access, sign-in or personal-data code.
- 18 Nov confirmations ("comfirmed(3)"): WAL10, NAV2 and MOT1 requests, the builder pre-push rule, the Home fidelity finding.
- NAV2, exact words: "header navigation link text wraps into two lines, which look bad. we need to keep/make this header menu most appealing, sophisticated ,worldclass, hooking, action oriented, extraordinarily converting & trust-creating, apple grade. same for footer."
- Motion, in order: "Phone motion (Recommended)"; "motion/animation should be always activr for all device and states"; "yes, carry on, full motion and comfirmed(3)"; final "what's best for user experience ,if that's gentle fading, do that". Applied: gentle fades for reduced motion, full motion for everyone else; the orchestrator asked the owner once to confirm.
- Docs: "u must the documentation with everything we have done so far".

Standing builder pre-push rule: typecheck (`NODE_OPTIONS=--max-old-space-size=8192`), lint, full web vitest, `node --test scripts/*.test.mjs`, relevant Playwright on one fresh build, ui-ratchet (lower only), em dash count 0. One PR at the TURN; known-issues chunk is the last commit; the builder opens the draft PR after the TURN checks and unsubscribes.

## 4. Follow-up list (nothing here has started)

1. Decline action on the sharing, client, contributor and agency invitation accept screens (needs a working decline action).
2. `/app/trips/[id]` can leave the signed-in guard's skipped list (seed a trip).
3. One shared row kit for the U7 and U8 screens.
4. `pictures-depth.css` and the `layout.tsx` Save-Data rule still draw pictures for data saver.
5. Bengali word lists from the WAL, U, R, NAV2 and MOT1 records go to the localization lane; `/how-it-works` is not in `BN_READY_ROUTES`.
6. Home checks: desktop first screen shows very large cropped document pictures; "Know where it stands" example starts on Closed with the Embassy tag (check against reference EhrC98).
7. Tidy unit: about 234 unused `home.page.*` keys, `.land-*` and `.c1` rules, dead CSS `.ai-connection-facts` and `.profile-read-summary`, unused key `appApplicant.appApplicantIdProfileEditor.editTheseDetails`, `everythingSavedForDisplaynameInOne` only after PR #581.
8. PR #581 refresh.
9. Load protected profile values only on Show (Class A).
10. Layout-guards rAF settle; Home phone page is 1 px under budget at 390.
11. Owner switches after real-device tests: `WEB_SHARE_TARGET`, `BACKGROUND_UPLOAD_SYNC`, `PROGRESS_CARD`, `PASSKEYS`, `SIGN_IN_LINKS`, `WEB_PUSH` plus keys.
12. Public-site verification pass after NAV2 (MOT1 is merged).
13. WP-SB2 "real case page" 3480 vs 3470 fails locally on clean main, passes in CI.

Other stale docs found, not edited here: `docs/uiux/ccd/PARITY-LEDGER.md` and `docs/roadmap/SONNET-SMALL-COMMERCIAL-V1-HANDOFF.md` section M have no Wallet or public-site rows; `docs/operations/current-platform.md` was not re-checked.

## 5. Pitfalls

- Guards that read pages: ui-ratchet baselines only go down; the signed-in route guard fails as soon as a `KNOWN_FAILING` page is fixed, so remove its line and lower the ceiling in the same PR.
- A unit that renames visible words leaves Bengali register rows to update (for example SG-fe32af9d, SG-f1e29103, SG-afd7a3f5 for My Record); never edit Bengali drafts from a page unit.
- Hot files (`globals.css`, `known-issues.md`) merge only with the tools in `scripts/steward/steward.config.json`; a `/* WP-<ID>` marker starts every CSS block.
- WP-SB2 "real case page" is red locally on a clean main; check CI before treating it as yours.
- Keep Neon branch `ccr-85d8af87-1wrzb7-e` until the owner says "delete ccr-85d8af87-1wrzb7-e".
- Cross-session messages need the session's listed name; a raw session id was not reachable from DOC1 (no live peers listed).
