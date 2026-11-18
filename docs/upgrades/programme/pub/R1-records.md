# R1 records: Home rebuilt on the approved reference

Branch `claude/r1-home-rebuild`, builder R1, 18 Nov 2026. Reference: the approved five-page artifact (Home chapters read from its page code). Kit contract: `R1-kit-contract.md`.

## What was wrong and what was done

The live Home was the old Harbor page with two thin scenes inserted. It is now the eight chapters of the reference and nothing else between header and footer: Record (dark, pinned), Add (dark, pinned), Ready (light, pinned), Journey (light, pinned), Share (dark, pinned), Sources (light), Agencies (light), Closing (dark). The old hero, country picker, mixed-size cards, question list, old scenes and the "Stop starting from zero." card are gone (`landing-c1.css`, `landing-scenes`, `landing-story` and their tests deleted). Home keeps today's two buttons and links, the pilot or beta line (`Invite-Only Pilot` / `Free Public Beta`), the sign-in problem notice, the exact public-beta terms line at the foot (same catalogue words the banner and legal pages use), the anchors other pages link to (`#how-it-works`, `#capabilities`, `#for-agencies`, `#start`), and the real Bangladesh passport PNG.

Fixed from the owner's list: no clipped chips; no count-versus-percent mismatch (one ring, one count); pinned scenes are centred and sized by their content (no half-empty stretch); nothing cut off on phones (checked at 390).

## Gate: per-chapter result

Spec: `apps/web/e2e/public-site/r1-reference-fidelity.spec.ts` (30 checks, all green on the built page: 3 runs x (8 chapters + order + budget)). Pictures in `r1-shots/`: `ref-*` is the reference rendered the same way (1440x900 scrolled to each chapter's end, with and without reduced motion; 390x844), `app-desktop-motion-*` the built Home with motion at chapter end, `app-desktop-*` the built Home with reduced motion, `app-phone-*` the built Home at 390. I set them side by side and judged by eye as well as by the spec.

| Chapter | 1440 motion on | 1440 motion off | 390 | What differs on purpose |
|---|---|---|---|---|
| 1 Record (dark, pinned) | pass | pass | pass | Brand blue and navy, not cyan or mint; real BD passport at the centre; deck uses the product's own drawings; today's two button labels; ring chip is navy so its numerals read on dark |
| 2 Add (dark, pinned) | pass | pass | pass | Scan line and glow are flat or absent (flat-design rule); fields in Title Case |
| 3 Ready (light, pinned) | pass | pass | pass | Flat card with the one approved raised card depth; row words Title Case (`Bank Statement`, `To Add`); phone shows the active country only plus two flags |
| 4 Journey (light, pinned) | pass | pass | pass | Stage names are the product's own words (Getting Started, Gathering Documents, Being Checked, Needs You, Ready to Submit, Submitted, Closed), tagged Example |
| 5 Share (dark, pinned) | pass | pass | pass | Still rests on the end-date step (the reference rests there too); `Access Ended` shows at the last scroll step |
| 6 Sources (light) | pass | pass | pass | Card art uses the product's document drawings |
| 7 Agencies (light) | pass | pass | pass | Status words are the product's own (`Being Checked`, `Needs You`, `Ready to Submit`) |
| 8 Closing (dark) | pass | pass | pass | Today's buttons; the terms line sits under the passport |

Tone order is the reference's (dark, dark, light, light, dark, light, light, dark), not strict alternation; the Guardian should record it as approved (the kit contract says so).

Measured on the built page: computer 11.0 screens with scenes live (limit 12), phone 5.65 in English and 5.86 in Bengali (limit 5.88 after the 2 percent margin). Scroll engine 1615 bytes gzipped (limit 2048); Home first-load JavaScript is below its recorded baseline; pictures 29 KB.

## Kit and engine

Kit in `apps/web/src/components/public-site/kit/` (contract file is the API; one unit test file, fixtures in `fixtures.ts`). Engine and styles: `Scene` takes `len` of 1.5 or 2.5 and `minWidth={900}` (below 900 a scene is finished and still, so 760 to 899 px never shows half-run scenes); a pinned stage is a grid with `align-content: safe center`.

## Words that need Bangla (English text on an English page until the localization lane adds them)

All new chapter and picture words come through `publicText` or fixed English lists: One record. / Every visa. / the hero line / Add it once. / Confirm what it reads. / Add, Read, Confirm and their lines / Ready for every trip. / Each country has its own checklist... / Know where it stands. / the seven stage lines and Illustration. Stages follow each real case. / You decide who sees what. / the five share captions / Every rule shows its source. / Source Shown, Checked Date, Changes Flagged and lines / Built for agencies too. / Clients keep their own record... / Start with your passport. / Add one document and see what your first trip still needs. / picture words: Add Document, Surname, Passport Ends, Nationality, Example record., Reused, To Add, Completeness only. Not an approval., Share with Agency, Not Shared, Photo page only, Agency can see..., Ends 31 Dec. Turn it off any time., Share, Turn Off, Access Ended, Everything is private again., Cases, Example names and counts..., The type of cover, not anyone's own passport. Catalogue words kept in Bangla: the pilot or beta line, the two buttons, For Agencies, the terms line.

## Tests changed outside the manifest (all listed in the ACK except the three marked *)

Unit: `landing-locale.test.tsx` deleted; `home-locale`, `language-marking`, `public-pages`, `surface-css`, `text-floor`, `headline-spacing-css`, `public-site-guards` (reads the kit folder and its two sheets) updated. E2E: `ux-public.spec.ts` (Home blocks rewritten, picker block removed), `WP-SB8.spec.ts`, `pub1-foundation.spec.ts`*. Styles: `public-site.css`* (scene length, safe centring, `data-min-width` un-pin) and `public-scenes.css` (kit card depth). Not touched: `scripts/programme/landing-baselines.cjs` and `make-landing-preview.cjs` (old one-off measuring tools for the retired landing); the `LANDING_EFFECTS_EXCEPTION` path in `check-flat-design.mjs` now names a deleted file (harmless, its own test asserts the string). The Guardian may want to retire both.

## Review

Independent fresh-context review (read-only) raised 12 findings; fixed: dimmed step lines now keep contrast (colour, not opacity), `Access Ended` is no longer a live region, the active country is named in the counted line, status words and Title Case aligned to the product, `minWidth` typed to 900, list keys include the position, a "Now:" marker for the current stage, end-date line shown only when it applies, contract rewritten to the built API. Left as known and recorded: first paint on a computer shows the finished state for a moment before the engine writes the start state (early mark runs before the body exists); empty ring segments are about 2.9:1 against the dark chapter (numerals carry the count); phone fields sit at opacity 0 at the scan step (live scrolling only).

## Not verified

Real devices and real visitors; Bangla layout beyond the page-height budget; the WP-SB2 case-page checks (`WP-LIFT-B the real case page`, page height 3368 against 3350) failed in my local run and I could not tell whether main fails them too (the Home change does not load that page); keyboard and screen-reader use by a person; CodeQL and CI on the pushed head.
