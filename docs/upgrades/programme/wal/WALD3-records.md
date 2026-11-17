# WALD3 records: the journey track at Glance

Unit WALD3 (Class B, lean). Branch claude/wald3-journey-track-glance, from main 6da17c9.

## Defect (measured on main 6da17c9)
- The stage row of the case status panel sits in div.lift-status-stages with a depth level
  (Browse with an agency on the case, Everything while the traveller is the only reviewer). Glance is
  where every screen starts, so a person saw no stage information at all.
- .lift-count dt labels spilled the card by 5 to 17 px, and a long unbroken case title spilled the
  Next Step by 184 to 800 px (never wrapped).

## What changed
| Part | Change |
|---|---|
| case-stage-glance.tsx (new) | The compact stage line: Now line, position words, segment strip. Same stage path as the step bar. No list, no aria-current. |
| case-status-panel.tsx | Renders the compact line in div.lift-status-glance, data-until glance (agency on the case) or browse (traveller only). |
| globals.css, block WP-WALD3 | Shows the line at Glance (and at Browse while no agency can see the case), hides it where the full row shows and with scripts off. Long words wrap in the Next Step, the count labels, the stage labels and the Now line. |
| WALD3.fixture.tsx, WALD3.spec.ts | The real CaseStatusPanel with made-up data, measured at 320, 360, 390, 768, 1024, 1280 and three depths, both managed kinds, with a 120 character unbroken title and About Stages open. |
| case-status-glance.test.tsx | Unit test of the compact line, its data-until values, that it reads the same position as the step bar and claims nothing done or approved. |

## Choice stated (acceptance item 1)
The full picture track and the step bar row stay exactly where they were: Browse and Everything with an
agency on the case, Everything only while the traveller is alone. Existing assertions in
page.test.tsx (levelOf '.lift-status-stages' is 'everything' alone) and journey-track.test.tsx
(card rules keyed on that wrapper's data-level) pin that, and the unit's rules forbid editing an
existing assertion without a DECISION. So a traveller-managed case shows the compact line at Glance and
at Browse, and the full track at Everything. Moving the traveller's full track to Browse needs those
two assertions changed: open DECISION.

## Red evidence on main (spec run against the unchanged build)
39 failed, 4 passed. Failures: compact Now line hidden at Glance (both kinds), traveller full track
at Browse, and every spill case (dt +5, +9, +17 px; p.lift-next-title +184, +440, +696, +730, +760,
+800 px). The About Stages cases fail on the same spills (8 failed).

## Green
WALD3.spec.ts: 51 passed. Unit tests under mission/[id], journey-track, title-case and vocabulary: 498 passed.

## Known, not caused here
WP-SB2 "real case page" height budget fails in this container on main (3368 vs 3350 at Browse) and
with this change (3362). CI is the judge of that budget.

## Not verified
Live signed-in page; Bengali wording (the line uses English stage words like the step bar); the full CI check.
