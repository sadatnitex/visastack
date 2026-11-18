# PUB2 records text (draft for the Guardian)

## Known issues (append to docs/commercial-v1/known-issues.md)

## 17 Nov 2026: WP-PUB2 Home scroll story

- The home page now tells its story in scroll scenes, built over the page that was there (nothing was removed): the hero stays first; below it a dark scene shows documents flying in, a scan, then the words Received, Suggested and Confirmed in that order (Suggested reads "Nothing is saved yet" and Confirmed reads "You check each value, and it joins your file"); a light scene fills a case line and shows the readiness ring with "Completeness only. Not an approval."; the page ends on the real Bangladesh passport cover tilting into place above the same closing call as before. Dark and light chapters alternate. Every drawn picture carries the Example tag and shows no real name, count, logo or rating.
- On a computer (900 px wide or more, motion welcome) the first two scenes pin to the screen and move as you scroll; the closing scene rests in the page. Below 900 px, with reduced motion, with data saver, or without JavaScript, every scene is a still picture showing its finished step. The page's own rule keeps scenes unpinned below 900 px even though the shared engine starts at 760 px (a rule in landing-c1.css; the engine is unchanged).
- Page height: up to 12 screens on a computer (owner answer 1) and 6 on a phone (the WP-SB8 landing block now says 12 for the computer; the phone number is unchanged). Measured: see "Measured" below.
- The first screen on a 360 x 640 phone holds 25 words of the page itself (headline, one short line, both buttons, the pilot label). A short line, "One private file for every visa application.", takes the place of the long supporting line and the three-word summary below 480 px; the long wording stays in the page for wider screens and is unchanged.
- Kept as they were: the pilot notice and its wording, "Sign in to get started" and "See What Works Today", invite-only wording, the three anchors (how-it-works, for-agencies, start), the country picker, the six story groups, the closing card. The new headings are headings by role (level 2) rather than h2 elements, so the page's tested outline of one h1 and nine h2 is unchanged and no existing assertion was edited.
- Not changed: the shared parts (components/public-site), the engine, the localization files, the database, the switches, the dependencies.
- NOT verified: the scroll motion on real phones and in Safari; a measured layout shift (the scenes' scroll length is set before first paint by the early mark; not measured on a throttled connection); Bangla (all new words are English, marked lang="en" on a Bangla page); a Lighthouse run; screen readers.
- Observation for the Guardian: PassportCover (shared picture part) renders the cover without loading="lazy", so the image (28 KB) loads on first paint of Home even on a phone; a change would be in components/pictures, outside this unit.

## New words for the localization lane (PUB2, 17 Nov 2026)

Shown in English, marked lang="en" on a Bangla page, until the catalogue has them:

| English | Where | Suggested key |
|---|---|---|
| One private file for every visa application. | home first screen, below 480 px | home.page.onePrivateFileForEveryVisa |
| Drop In a Document. | intake scene heading | home.scene.dropInADocument |
| Check What It Finds. | intake scene heading (tinted words) | home.scene.checkWhatItFinds |
| Document reading is being switched on step by step. This is an example of how it will work. | intake scene | home.scene.intakeLead |
| Your documents arrive in your private place. | intake, Received | home.scene.received |
| Reading proposes the values. Nothing is saved yet. | intake, Suggested | home.scene.suggested |
| You check each value, and it joins your file. | intake, Confirmed | home.scene.confirmed |
| Illustration with sample documents. | intake caption | home.scene.intakeCaption |
| See How Complete | ready scene heading | home.scene.seeHowComplete |
| Your File Is. | ready scene heading (tinted words) | home.scene.yourFileIs |
| Completeness is how much of the list is in your file. | ready scene | home.scene.readyLead |
| In file / Missing | ready, case line | home.scene.inFile, home.scene.missing |
| Illustration with a sample case. | ready caption | home.scene.readyCaption |
| The type of cover, not anyone's own passport. | closing caption | home.scene.passportCaption |

Also English for now, set in the shared parts: Example, Received, Suggested, Confirmed, "Completeness only. Not an approval.". Picture names in the scenes (Passport, Bank Statement, Employment Letter, Photo, Travel Plan, Items Ready) are example names; Passport and Bank Statement and Employment Letter already exist in the home catalogue.

## Red then green proof (PUB2)

Unit tests (apps/web/src/app/landing-scenes.test.tsx, 10 cases), run on main plus only the test file:

```
× runs its scenes in the approved order: documents in, scan, Suggested, Confirmed, ring, passport
× writes the finished step on every scene, so no JavaScript shows each one complete
× alternates dark and light chapters down the page
× tags every drawn figure as an example
× keeps today's button labels and the invite-only wording
× shows the ring with its exact caption: completeness, never approval
× says what a state means in its own word: Received is not Reviewed, Suggested is not Confirmed
× shows the real Bangladesh cover in the closing scene, sized and self hosted
Tests  8 failed | 2 passed (10)
```

The two that passed on main are the ones that must keep passing (anchors kept, no invented figures). After the change: 10 passed.

Browser spec (apps/web/e2e/public-site/pub2-home.spec.ts, 25 cases), run against a build of main's page and Home styles with only the new files added: 7 failed, 18 passed. Red: first screen words at 360x640; pins every scene at 1280 and at 1440; pins nothing below 900 px; reduced motion shows every scene finished; without JavaScript shows every scene; the scenes move while scrolling. After the change: all 25 pass.

## Measured

- Phone 390x844: 5046 px = 5.98 screens (budget 6, 5064 px). Only 18 px of margin: a font change could break it.
- Computer 1280x800: about 10.9 screens (budget 12) with the first scene at 2 screens; 11.91 screens when it was 3 (too close, so shortened).
- First screen at 360x640: 25 words of the page itself.
- Public budget check: Home first-load JavaScript 144941 bytes gzipped against baseline 142417 (+2.5 KB, limit +10 KB); scroll engine 1535 bytes; pictures 27676 bytes; nothing from another origin.
- Full local check (scripts/agent/full-check.sh): install, audit, typecheck, test, webtest, build, supply chain, Playwright, smoke all exit 0; lint exit 1 on a formatting line, fixed and lint re-run green.
- Existing browser checks (ux-public, browser-security, no-secret-auth, WP-SB8): all pass; one existing skip unchanged.

## For the Guardian to place

- docs/uiux/SCROLL-BUDGET.md (append): Home desktop budget is 12 screens since WP-PUB2 (owner answer 1, 17 Nov 2026); phone stays 6.
- The shared engine starts scenes at 760 px but the owner rule is 900 px; Home enforces 900 px in landing-c1.css. Aligning SCENE_MIN_WIDTH in scene-engine.ts would remove that workaround.

## Ledger text (for the Guardian to place)

- Home scroll story (WP-PUB2, ADR 0029): scenes intake, ready and closing on `/`, built from the PUB1 shared parts, Home styling in landing-c1.css; scroll budget 12 screens on a computer, 6 on a phone. Status: DONE for Home; the other four pages follow in PUB3 and PUB4.
