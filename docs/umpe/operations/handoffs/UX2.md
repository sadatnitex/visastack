# UX2 hand-back: the group trip page and Home polish (no migration)

- Branch `claude/relaxed-hamilton-632cw4` (PR 424), on top of UX1. Tables: none. No service, action, permission, consent or stored-value change. Presentation only.
- Method: the real page was rendered first (server markup, real stylesheet, Chromium, made-up data), judged, then changed. Home turned out to be already strong (Next Step, Start Here, Needs Attention, Coming Up, a Glance level that is about one phone screen), so it was not redrawn: only what added something was applied.
- Group trip (`apps/web/src/app/app/trips/`):
  - One Next Step (the platform's existing dark block) names the traveller who needs attention first, then the one ready for a final review; none when every package is prepared or unreadable. The cards' own buttons become secondary so the block holds the one filled button.
  - A three-stage tracker on each card (Needs Attention, Ready for Final Review, Prepared for Handoff), with one spoken sentence ("Needs Attention, stage 1 of 3").
  - Remove from Trip is a quiet link (your WP-C2 note asked for quieter destructive controls).
  - Shared documents say Allowed or Not Allowed in words beside each traveller; the button says only what it does ("Use", "Stop Using") and its spoken name keeps the traveller and the document.
- Home and every dated list (`(home)/page.tsx`, `components/deadline-clock.tsx`):
  - Start Here: a picture and an arrow on each of the three tasks.
  - Coming Up (also on the Expiry page and a traveller's Home): a date tile ("12 NOV") on each line, hidden from a screen reader because the written date stays. A date that does not exist (31 Feb) draws no tile.
  - Card links are no longer underlined like sentence links (the underline rule had been catching whole cards). A new guard test, `lib/card-links-css.test.ts`, fails if a card link is added back to that rule.
- Styles: one block, `WP-UMPE-UX2`, plus the tile rules inside the existing `WP-G5` deadline block, where that block's own guard expects them. Flat-design check passes.
- Measured on the real page with made-up data (phone 390 wide, screen 844; desktop 1184 wide, screen 800), before then now:

| Page | Phone | Desktop |
|---|---|---|
| Group trip (3 travellers, 2 shared documents) | 2,227 px (2.64) to 2,530 px (3.00) | 1,837 px (2.30) to 1,802 px (2.25) |
| Home, quiet | 976 px (1.16) to 997 px (1.18) | 1,521 px (1.90) to 1,542 px (1.93) |
| Home, busy (two travellers, many items) | 1,038 px (1.23) to 1,059 px (1.25) | 3,096 px (3.87) to 3,117 px (3.90) |

- Budget: the trip page fits 3 screens on a phone (it grew 0.36 screen for the Next Step and tracker). Home's busy desktop state was already over 2 screens before this change and stays so; the test data repeats every item for every traveller, so it overstates a real account, and Home's own depth levels (Glance, Browse, Everything) are the tool for it.
- Tests: trip (5 new), date tile (4 new, including a day that does not exist), Start Here (1 new), card-link guard (3 new). Proven red by breaking the traveller order, the month lookup and the card-link exclusion, then restored. Home, trip, component, wording and surface tests: 1,211 passed before the new ones; the touched folders pass after. axe (WCAG 2.2 AA and best practice): no violation on the trip page or Home at 2 widths. No sideways scroll at 320, 360, 390 or 1184.
- Review (`/code-review high`): 10 findings; 8 fixed (dated lines no longer wrap on a phone, impossible days, tile computed once, a type cast, the allow row squeezed by a long message, the underline exclusion now guarded, the arrow also moves on keyboard focus, a plainer Next Step line); 2 declined with reasons (Remove stays grey, as the owner's WP-C2 note asks; the Next Step and the card both link to the same case, as Home's Needs Attention already does). `/security-review`: not run, no data or action moves.
- Not done: the agency request desk (concept only; it needs the agency collection page rendered first). Not verified: a live or signed-in account, a screen reader, a real phone, dark appearance, the e2e scroll-budget and `ux-public` browser checks (they run in CI).
