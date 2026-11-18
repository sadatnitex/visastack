# WAL3 records: Trip Package as a journey line with gaps

Unit WAL3 (Class B, lean). Branch claude/wal3-trip-package from main 7df6af80. Owner decision 17 Nov 2026, Trip Package "-A" (Journey Line With Gaps); Guardian approval of the manifest, the out-of-manifest tests and the wide-screen choice (Case Details and Trip Date Checks stay open on a wide screen, folded with a one-line summary on a narrow one).

## What changed
| Part | Change |
|---|---|
| mission/[id]/trip-journey-line.tsx (new) | Stones from the existing package items (ready, gap, still to confirm), gap rows (one line, one button), the four Outside VisaStack pictures with Explain popups. No rule, service or route change. |
| mission/[id]/package-panel.tsx | Shows the gap rows and the four pictures; every other line is as before. Takes an optional itemHref. |
| mission/[id]/page.tsx | The journey line is drawn above the Trip Package card with no depth level, so it shows at every depth (Defect 3). The WALD3 stage line is untouched and not repeated. |
| mission/[id]/case-rail.tsx | Case Details and Trip Date Checks use Expandable Section (RailSection). Anchor ids, depth levels and the open-when-a-check-needs-a-look rule are kept. |
| mission/[id]/open-fold-on-link.tsx | Also opens a closed Expandable Section around a link target (one selector). |
| globals.css, block WP-WAL3 | Stones, gaps, outside pictures, and the wide-screen rule that shows the section's card and hides its row. |

## Layout after the Guardian's final decision (18 Nov 2026)
- One journey card above the Trip Package card, at every depth: "N of M ready", the stones, and the gap rows in a bounded area two rows high that scrolls inside the card (never the page). The journey card has no depth level; the WALD3 stage line is untouched.
- Trip Package card: heading, an Explain popup (About This Package) that holds the old paragraphs ("This shows what you have ready ...", the file-choice hint, "VisaStack does not do these for you ...", "Travelling with others? ..."), a Start a Trip button (the one action of those paragraphs stays one tap), the one visible line "Nothing is sent until you share it yourself.", then Outside VisaStack as one row of four 44 px pictures (Form, Book, Bring, Pay), each with its full sentence in an Explain popup.
- Case Details and Trip Date Checks: Expandable Section, one-line summary (Trip Date Checks leads with its status word so a narrow row never cuts it off), open on a wide screen, folded on a phone.

## Page budget (WP-SB2 LIFT.phonePage), measured in the same container, 60 items and 17 gaps
| Page | main | WAL3 | Net | Limit before | Limit now |
|---|---|---|---|---|---|
| Phone Everything | 3633 | 3746 | +113 | 3700 | 3820 |
| Phone Browse | 3368 | 3480 | +112 | 3350 | 3470 |
Raised by the measured net rounded up (+120) on the Guardian's decision. This container measures main at Browse 18 px over its own limit; CI is the judge for Browse (here Browse reads 10 px over the new limit for that reason). The journey card is 330 px at the worst case, the Trip Package card went from 438 to about 250.

## Reviews
Code review (high) and an accessibility read found and I fixed: duplicate rail headings on a phone (the card head is now display none there), the status word cut off in a closed row (now leads), two always-focusable scroll areas (now only when they can scroll), a copied item-name helper. Not fixed, on purpose: the new journey words are English literals not yet in the catalog (below); stones to confirm have no button (the owner's design gives buttons to gaps only); the Outside names are the owner's four words (Form, Book, Bring, Pay); the rail-section CSS repeats the rail fold pattern (a later clean-up); the general notes now sit in a popup, which the Guardian approved.

## New English words (localization lane; Bengali drafts not edited)
Trip Package Journey Line; What This Trip Needs; What Is Missing; "N of M ready"; Add; Fix; "<Name> <State>. Add <Name>." / "Upload a current <Name>." / "Pick the right value for <Name>."; Form; Book; Bring; Pay. The Trip Date Checks row summary now reads "<status word>, a middle dot, <count> checks on your trip dates" (was a separate chip). Also: About This Package; Start a Trip; Nothing is sent until you share it yourself.; Steps Outside VisaStack; More That Is Missing. All of these are written in the component, not in the catalog yet (the old sentences keep their Bengali keys).

## Not changed on purpose
Package service, readiness rules, policy, routes, every link and action. Readiness stays completeness, never approval.
