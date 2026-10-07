# UI and UX upgrade report (October 2026)

Frontend only. No API, data, permission, rule, billing or integration change.

## Before and after

| Area | Before | After |
|---|---|---|
| Look | Apple-style: pill buttons, frosted bars, large rounded cards, one bright blue | Calm ledger look: paper background, navy ink and buttons, one blue for links and focus, one teal for progress, square-ish 8 to 12px shapes, flat cards with hairline borders |
| Signed-in navigation | Two sticky bars stacked under the public header | Sidebar on a laptop or larger; compact chips and a row of switch buttons on phone and tablet |
| Status | Colour dots | A tick, triangle or cross as well as colour, plus a short label |
| Home (traveller) | Count cards | One next step with its reason, a get-started checklist, what else is waiting, a row per applicant |
| Home (agency) | Count card | Get-started checklist, then what needs you first, in urgency order |
| Case page | Long grid of equal cards | Attention strip, jump links, readiness first and full width, secondary panels folded away |
| Public home | Centred headline and cards | Two-column hero with an example case (made-up details, labelled), how it works, traveller and agency sections |

## Design system

- Tokens in `apps/web/src/app/globals.css`: palette, radii, shadows, header height, sidebar width. All text and fill pairs are 4.5:1 or better in light and dark (checked by calculation and by the axe contrast check in `e2e/ux-public.spec.ts`).
- Components in `apps/web/src/components/ui.tsx`: StatusBadge, NextStepCard, AttentionList, EmptyState, Disclosure, Checklist.
- Helpers: `lib/format-date.ts` (month as a word, days until a date), `lib/format-code.ts` (stored code to words), `lib/format-size.ts`.
- Fonts are system fonts only (the page policy allows no web fonts). Bengali falls through to the best installed Bengali face and gets more line height.

## Verified

- Lint, typecheck, 71 test files (1,060 tests), production audit, web build.
- Browser layout checks against the real stylesheet (`ux-public`, `browser-security`, `no-secret-auth`): 75 pass; 2 sign-in redirect tests fail only in the sandbox because the identity provider is unreachable.
- Signed-in pages rendered with made-up data into static pages and screenshotted at 390 and 1440px: traveller home, applicant overview, evidence requests, agency dashboard, public home. No sideways scroll.

## Not verified

- Signed-in pages in a live browser (sign-in needs the identity provider).
- The case page was not rendered (too many data sources to stand in for); it has type checks and the shared tests only.
- Slow-network behaviour, screen-reader testing by a person, Bangla rendering.

## Found, not changed

- Production reports virus scanning as not configured; the upload form now only claims a scan when one is on.
- Server messages such as "Missing case." are for tampered requests; left as they are.
- The app has no data tables, so there was no table-to-card work to do.

## Remaining debt

- P0: a signed-in visual pass on staging at phone and desktop sizes.
- P1: case page panels still use their own older spacing; admin screens only got the new tokens and date change; guided first-run for agencies beyond the checklist.
- P2: icons in the sidebar; a self-hosted font file if the owner wants one.
