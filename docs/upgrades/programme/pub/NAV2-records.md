# NAV2 records: header and footer (18 Nov 2026)

Owner request (18 Nov 2026, exact words): "header navigation link text wraps into two lines, which look bad. we need to keep/make this header menu most appealing, sophisticated ,worldclass, hooking, action oriented, extraordinarily converting & trust-creating, apple grade. same for footer."

## What changed

- Header: one calm row. Brand on the left, the five pages in the middle, the language switch, a quiet Sign In and the one filled Get Started on the right. Every link and button is one line (nowrap) at every width, 44 px tall, with a visible focus ring. The current page has `aria-current="page"` plus a 2 px marker bar under it (a 3 px bar at the left in the menu), so it is not colour alone. The bar stays solid white with a hairline edge (no translucency, blur or shadow), so it reads over light and dark sections.
- Menu: where the full row stops fitting, the pages, the language switch and the quiet Sign In move into the existing phone menu (`SiteNavigation`). The primary action stays in the bar: Get Started when sign-up is open, else Sign In (filled), or Workspace for a signed-in person. Button name, `aria-expanded`, focus to the first link, Escape closing and focus return are unchanged. The menu also closes after the language is chosen.
- Footer (`site-footer.tsx`): brand with one line about what VisaStack is ("One private profile for every visa."), three groups (Product, Trust, Account), and a base line with the copyright and the page's own version line. On a laptop the groups sit side by side. On a phone the footer has to stay about as tall as the old one (the page height budgets leave 229 px in Bengali), so the three groups keep their lists and their names for a screen reader but their group names are visually hidden and their links flow in rows of 44 px targets (the rows overlap by the extra height, as the old footer links did). This is a trade-off against "stacks to one column": every link is still its own 44 px target and nothing scrolls sideways, but a sighted phone visitor sees one block of links, not three labelled lists. Every link opens an existing page; "Privacy and Trust" is the one name for /trust everywhere (owner decision 17 Nov 2026).
- Menu panel scrolls inside itself when the screen is short (max-height with overflow), the current-page marker has a forced-colours version, and choosing a link or the language keeps focus on the menu button.
- Phone detail: under 400 px the menu button shows its icon only (its name stays "Menu"); under 361 px the brand and Get Started tighten so the bar fits at 320 px.

## Measured breakpoints (built page, Chromium, Inter and Noto Sans Bengali self-hosted)

The header is 0.905 x the viewport wide below 1600 px (page margins), minus 48 px of padding and border. The full row needs, with sign-up open (worst case: language switch, Sign In and Get Started):

| Language | Row needs (inner width) | First viewport width that fits | Menu below |
|---|---|---|---|
| English | 976 px | 1132 px | 1150 px (`max-width: 71.875em`) |
| Bengali | 1048 px | 1211 px | 1230 px (`max-width: 76.875em`) |

About 19 px of room is kept. The breakpoints are in `em`, so a larger browser text size moves the menu point with it. The two sets of menu rules sit under `html:not([data-locale="bn"])` and `html[data-locale="bn"]`, generated from one body so they cannot drift. The e2e spec holds the same two numbers (`FULL_ROW_FROM`) and tests the width on each side of them.

On main, rows below about 1180 px (English) wrap or overflow; the owner's screenshot is consistent with a browser zoom or a narrower window than its pixel width. Not reproduced at exactly 1344 px on a built page.

## Tests

- New e2e `apps/web/e2e/public-site/nav2-header-footer.spec.ts` (32 tests): header one line each and inside the bar at 320, 390, 768, 1024, 1180, 1280, 1344, 1440, 1920 and on each side of both breakpoints, English and Bengali, menu open and closed, signed in (the one link swapped on the real page, since e2e cannot sign in); menu keyboard behaviour; current-page marker; 44 px targets and focus ring; solid bar; one filled button; footer groups, columns, 44 px links, links open. Run against a build of main it fails 20 of 32 (the sweeps at 1151 and wider pass on main at exact widths; the failures there are the new structure and the widths below the old row).
- New unit `apps/web/src/app/layout-header-footer.test.tsx` (parsed DOM): order, aria-current, one filled action in the three states, one language field, footer groups and link targets against the page files, no unbacked claims, version line equals the page notice, and a stylesheet guard that the public header and footer stay hidden inside the signed-in app and the sign-in frame (my first draft of the block showed the header inside the app; the existing appearance checks in ux-public caught it and this guard now names it).
- Updated for the new structure: `layout.test.tsx`, `page-titles.test.ts` (3 source-string asserts, approved), `components-bn-coverage.test.tsx` (render only, approved), `ui-lift.test.tsx` (`|NAV[0-9]+` in the later-block list, approved).

## Files (manifest, with the Guardian-approved additions)

`apps/web/src/app/layout.tsx`, `apps/web/src/components/site-navigation.tsx`, `apps/web/src/components/site-footer.tsx` (new), `apps/web/src/components/public-site/public-nav.ts`, `apps/web/src/app/globals.css` (one block at the end, `/* WP-NAV2` to `/* end WP-NAV2 */`), `apps/web/e2e/public-site/nav2-header-footer.spec.ts`, `apps/web/src/app/layout-header-footer.test.tsx`, `apps/web/src/app/layout.test.tsx`, `apps/web/src/lib/page-titles.test.ts`, `apps/web/src/components/components-bn-coverage.test.tsx`, `apps/web/src/components/ui-lift/ui-lift.test.tsx`, `apps/web/e2e/ux-public.spec.ts` (one locator), this file, `nav2-shots/`.

Left alone on purpose: `.sticky-action-bar` and the phone bottom nav (FIX9), `public-site.css`, scene files, page bodies, ADR 0029. The older `.footer-inner` and `.footer-links` rules in `globals.css` are no longer used by the footer; they stay (append-only stylesheet rule) and can go in a later clean-up.

## Bengali words

New catalogue keys in `home.ts` (English and Bengali; sources in `home.sources.json`). The Bengali below is for localization review: the rows marked "register draft" use the register's own draft for the same English (still DRAFT_NOT_FOR_RELEASE); the rows marked "new" have no register row and were written here.

| Key | English | Bengali | Where it comes from |
|---|---|---|---|
| `home.layout.language` (Bengali was missing) | Language | ভাষা | register draft (SG-ce01db35) |
| `home.layout.footerAccount` | Account | অ্যাকাউন্ট | register draft (SG-0a8720d7) |
| `home.layout.footerTrust` | Trust | আস্থা | new (no register row; note the open "Public Trust" term decision) |
| `home.layout.footerAbout` | One private profile for every visa. | প্রতিটি ভিসার জন্য একটি ব্যক্তিগত প্রোফাইল। | new |
| `home.layout.noticePublicBeta` | VisaStack Public Beta | VisaStack পাবলিক বিটা | register draft (SG-755ddf32) |
| `home.layout.noticePublicBetaShort` | Free, at your own risk. | বিনামূল্যে, আপনার নিজের ঝুঁকিতে। | register draft (SG-6105d452) |
| `home.layout.noticePilot` | VisaStack Private Pilot | VisaStack প্রাইভেট পাইলট | register draft (SG-f746eb40) |
| `home.layout.noticePilotShort` | Test version. Made-up details only. | পরীক্ষামূলক সংস্করণ। শুধু বানানো তথ্য। | register draft (SG-b9398c95) |

The two new rows have source ids made from their English text (no register group exists yet). The page's own notice at the top still shows these words in English only; the footer's version line now reads them from the catalogue, so on a Bengali page the footer line can be Bengali while the notice above it is English until the notice moves to the catalogue.

Everything else comes from existing keys (`home.layout.*`, `home.page.*`, `auth.authSignInPage.signIn`, `components.siteNavigation.*`). `home.layout.features` and `home.layout.publicTrust` are no longer used by the footer and stay for the tidy-up unit.

## Verification run (frozen head, one fresh build)

- Typecheck, lint (biome, flat design, route navigation, ui-ratchet at the baseline: inline styles 286, raw codes 0, em dashes 0, folds 189), full web vitest, `node --test scripts/*.test.mjs` (83 of 83), em dash sweep 0.
- Playwright on the one build, with sign-up open and again with sign-up closed: the whole suite passes except the two known WP-SB2 "WP-LIFT-B the real case page" tests, which fail the same way on a build of main in this container.
- Independent accessibility review (fresh agent, read-only). Applied: the menu panel scrolls inside itself on a short screen, a forced-colours marker, focus kept on the menu button after any choice. Round two (Guardian fix list): the menu now closes on focus leaving it and on a press outside; focus returns to the menu button only after the language button (a page link takes the person to the page); `role="list"` on the footer lists (with the two lint rules suppressed in place, with reasons); bar sized in rem with a minimum height and wrapping so 320 px at 200 percent text keeps Get Started and Menu fully visible (e2e, English and Bengali); header current page now uses the shared `isCurrentPath`; a unit test proves the English and Bengali menu rules are the same rules; an e2e proves the public header and footer are hidden on the sign-in frame. Not applied: a nav list wrapper for the five links, a different name for the Site landmark, closing the menu on an outside click, a menu-only entry for Get Started at 320 px with very large text.

## Known-issues chunk (to append)

NAV2 (18 Nov 2026): the public header and footer were rebuilt (branch `claude/nav2-header-footer`). Header: one row, every link and button one line at 320 to 1920 px in English and Bengali; the pages, language switch and quiet Sign In move into the existing menu below 1150 px (English) and 1230 px (Bengali), measured full-row widths 1132 and 1211 px; Get Started, or Sign In or Workspace, stays in the bar; current page has aria-current and a marker bar. Footer: Product, Trust and Account groups, one line about VisaStack, the page's own version line, the copyright; on a phone the group names are hidden visually and the links flow in rows to keep the page height budgets. New: `apps/web/e2e/public-site/nav2-header-footer.spec.ts` (32 tests), `apps/web/src/app/layout-header-footer.test.tsx`. Verified on a built page in Chromium, sign-up open and closed. Not verified: Safari and real phones, a screen reader pass, text sizes above 100 percent, a real signed-in session, the owner's reading of the design and words.

## CI notes

- The phone footer measured 244 px in Bengali on the CI machine (221 px here) against the 240 px guard, so the phone footer was tightened by about 17 px (top padding, gaps, base padding, link overlap 9 px) rather than raising the guard.
- `e2e/wallet/fix9-sticky-bar.spec.ts` "each hidden file picker has one tab stop" timed out once under load here and passed alone, and passed on retry in CI. NAV2 does not touch the wallet pages or the file pickers; the only shared surface is the page frame, where the public header and footer are hidden inside the app by the rule at the end of the NAV2 block. Logged as a likely load flake, not a NAV2 effect.

## Not verified

- Safari and real phones; a screen reader pass; a pass by a person on the design and the words.
- The signed-in header is checked on the real page with its one link swapped, and by the unit test on the server markup; no real signed-in session was used.
- Bengali text at browser text sizes above 100 percent was not measured; the `em` breakpoints are designed for it. At 320 px the bar wraps Get Started and Menu to a second row at 200 percent text (checked with a stylesheet text size, not the browser setting).
- Footer lists on phones use `display: contents` with `list-style: none` and an explicit `role="list"`; not tested in Safari or VoiceOver.
