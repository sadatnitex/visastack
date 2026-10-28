# ADR-0023: Calm Core With Depths on the signed-in screens

- **Status:** Accepted (mechanism and Account screen built; other screens follow in packages CCD-2 to CCD-7)
- **Date:** 2026-10-28
- **Deciders:** Owner (approved the Calm Core With Depths canvas and decisions D1 to D5 on 2026-10-28)
- **PRD/Spec link:** `docs/uiux/PDF-TO-FUNCTION-MAPPING.md`, `docs/uiux/FUNCTIONAL-NONREGRESSION.md`, `docs/uiux/ccd/PARITY-LEDGER.md`; amends ADR 0016 (see section 5)

## Context

Signed-in screens show everything at once, so the thing a person needs now competes with controls they use once a month. Three places also disagree about "what next" (Home, the traveller overview, the Documents and Profile notices), pages name the same thing differently, and most pages have no clear single page heading. The owner approved a presentation change: every signed-in screen offers the same three levels, **Glance**, **Browse** and **Everything**, in the same place, remembered per screen.

The promise that outranks the look: no feature, control, state or message is lost, hidden for good or broken.

## Decision

1. **Mechanism.** The server always renders every level. Each block carries `data-level="glance|browse|everything"` (none means always shown). A scope element carries `data-depth="glance|browse|everything|auto"`; the stylesheet hides blocks past the chosen level with `display: none`. `auto` means Glance up to 760px wide and Browse above. Nothing is unmounted, so typed values survive a change of level, tests see every block, and a visitor without scripts sees all of it (a `noscript` rule).
2. **The switch** (`apps/web/src/components/depth-switch.tsx`) is one shared client component: three buttons with `aria-pressed`, one calm sentence per level, a polite status line ("Showing Browse"), keyboard focus kept on the switch. It changes one attribute, so there is no re-render and no layout shift.
3. **Memory.** A first-party cookie `vs_depth` holds a map from screen family to level word and nothing else. Path `/app`, SameSite Lax, Secure on https, one year. The server reads it so the first markup already has the right level. Unknown families and levels are dropped on read. No personal data, no analytics event.
4. **Links never land on hidden content.** On load and on `hashchange` the switch finds the lowest level that shows the target (its own and every enclosing block), raises the level if needed (without overwriting the saved choice), then scrolls and moves focus. `?depth=glance|browse|everything` works the same way for links from emails and notifications.
5. **Ranking (D1).** Home, the traveller overview and the Also Waiting lists will use the Needs Attention service (`packages/services/src/attention.ts`) as the single source, filtered to the person where relevant, with Home's wording. **Rules R1 and R2 are not adopted yet.** The service reads each case's id, title, state and creation time and each document's expiry day; it does not read case travel dates, deadlines or which documents a case uses. R1 (an expired document used by an active case is Past Due) and R2 (a document expiring before a case ends is Due Soon) would need new reads, which the decision forbids. ADR 0016 therefore stands unchanged. Recorded in `docs/commercial-v1/known-issues.md`; the owner can approve the extra reads later as their own change.
6. **One page heading (D2).** Every signed-in page has exactly one H1 naming the page, then H2, then H3 with no skipped level. The shell, sidebar and toolbar contain no heading. Guard: `headingProblems` in `apps/web/src/lib/ccd/inventory.ts`, applied to each converted screen.
7. **One name per thing (D3).** `docs/uiux/ccd/VOCABULARY.md`. Routes and file names do not change. "Traveller" replaces "applicant" in user-facing text; neither `PRODUCT-CONTRACT.md` nor `vocabulary.test.ts` requires "applicant", so no exceptions are needed so far.
8. **Request count (D4).** "Pending Requests" will mean every request not yet closed (Open, Needs Replacement, Received, Under Review), with a second line "{n} waiting on travellers, {m} waiting on you". The two groups become exported constants in the services package and every count uses them. This agrees with ADR 0015 point 5 (waiting on the traveller is Open or Needs Replacement); it widens the tile only. Built in CCD-6.
9. **Upload rules (D5).** The per-file limit and the virus-scan condition for PDFs will be printed under the file picker from the same constants the server uses. Built in CCD-3.
10. **The nothing-lost guard.** For each converted screen a baseline inventory (headings, links, buttons, fields, sentences, each with its name) is captured from the screen before it changes (`apps/web/src/lib/ccd/baseline/<screen>.json`). `parity.test.tsx` renders the screen in every state and fails if any baseline element is gone, unless it is listed in `approved-changes.ts` with a reason, and the same list appears in `PARITY-LEDGER.md` for the owner to read.

## Consequences

- **Positive:** one shared pattern, learned once; nothing removed; deep links keep working; the saved choice carries no personal data; each later package is mostly moving blocks between levels.
- **Negative / trade-offs:** hidden blocks are still in the page weight; `display: none` on a block that is a flex or grid container returns it to plain block layout for a visitor without scripts, so level wrappers must be plain blocks or use `depth-item` (display: contents). Phones start at Glance, which is calmer but means a person must tap once to see more.
- **Follow-ups:** CCD-2 to CCD-7; the phone search entry (only if it can be built on the existing search with no new backend); owner decision on R1 and R2 reads.

## Alternatives considered

- **Hide levels on the server (render only the chosen level).** Rejected: loses typed values on change, hides content from tests, and can strand deep links.
- **Separate pages per level.** Rejected: triples the routes and breaks every anchor.
- **A per-account setting in the database.** Rejected: needs a migration and carries a preference for no reason a cookie cannot serve.
