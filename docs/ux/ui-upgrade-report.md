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
| Public home | Centred headline and cards | Two-column hero with an example case (made-up details, labelled), how it works, traveller and agency sections, promises with ticks, a footer with links |
| Phone navigation | A block of wrapping links at the top | A bar at the bottom of the screen within thumb reach: four destinations and "More" for the rest and the switch buttons |
| Agency inbox | A stack of rows | A real table (case, stage, readiness, needs attention, assigned, confirmed) that turns into labelled rows on a narrow screen, a one-bar pipeline of cases by stage, and a strip of the numbers to scan first |
| Admin lists | Stacked rows | Tables for organizations and the audit trail |
| Applicant overview | Four equal cards | Two columns: next step and cases on the left, profile, documents and sharing in a rail |
| Page headers | Hand-built on every page | One page-header component (label, title, sentence, actions, back link) on every page |
| Type | System fonts | Inter for Latin and Noto Sans Bengali for Bangla, self-hosted (about 160 KB, the Bengali file only loads on a page with Bangla) |
| Icons | None | A small drawn icon set in the navigation, the switch buttons and empty states |

## Design system

- Tokens in `apps/web/src/app/globals.css`: palette, radii, shadows, header height, sidebar width. All text and fill pairs are 4.5:1 or better in light and dark (checked by calculation and by the axe contrast check in `e2e/ux-public.spec.ts`).
- Components in `apps/web/src/components/ui.tsx`: StatusBadge, NextStepCard, AttentionList, EmptyState, Disclosure, Checklist.
- Helpers: `lib/format-date.ts` (month as a word, days until a date), `lib/format-code.ts` (stored code to words), `lib/format-size.ts`.
- Fonts are served from this site (`apps/web/src/app/fonts`, licences beside them), so the page policy needs no change. Bangla text gets more line height.
- Icons are drawn in `components/icons.tsx`; no icon package.

## Verified

- Lint, typecheck, 71 test files (1,060 tests), production audit, web build.
- Browser layout checks against the real stylesheet (`ux-public`, `browser-security`, `no-secret-auth`): 75 pass; 2 sign-in redirect tests fail only in the sandbox because the identity provider is unreachable.
- Signed-in pages rendered with made-up data into static pages and screenshotted at 390 and 1440px, light and dark: traveller home, applicant overview, evidence requests, agency dashboard, case page, public home, and the phone navigation sheet. No sideways scroll.
- New browser layout checks: the bottom bar stays at the bottom and never covers the end of a page; every link and switch button is reachable on a phone once "More" is open.

## Not verified

- Signed-in pages in a live browser (sign-in needs the identity provider).
- Slow-network behaviour, screen-reader testing by a person, Bangla rendering.

## Found, not changed

- Production reports virus scanning as not configured; the upload form now only claims a scan when one is on.
- Server messages such as "Missing case." are for tampered requests; left as they are.
- The app has no data tables, so there was no table-to-card work to do.

## Remaining debt

- P0: a signed-in visual pass on staging at phone and desktop sizes.
- P1: the forms inside the case page (tasks, appointments, letters) still use their older spacing; the admin dashboard and settings pages use the new tokens and header but their card layouts are unchanged; inline `style` is still used in about 1,000 places and should move into classes over time.
- P2: icons for the agency and admin tab bars.
