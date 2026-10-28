# Contrast and surfaces (WP-C2)

The signed-in app passed every text contrast check, yet it read as one pale sheet: the page, the sidebar, the cards, their edges and the three text tiers all sat within about 1.3:1 of each other. WP-C2 separates them with tone and edges only. No shadows, gradients, blur or translucent fills, and no layout, copy or behaviour change.

Ratios are WCAG 2.x, computed from the tokens in the first `:root` block of `apps/web/src/app/globals.css`. "Measured" values come from the live signed-in site on 28 and 29 Oct 2026. Tests that hold them: `apps/web/src/lib/palette-contrast.test.ts` ("surfaces stay separable (WP-C2)") and `apps/web/src/lib/surface-css.test.ts`.

## Measured, target and actual

| Item | Measured before | Target | Actual after |
| --- | --- | --- | --- |
| Sidebar fill vs page | 1.08 | 1.16 | 1.16 |
| White card or header vs page | 1.05 | unchanged (flat by decision) | 1.05 |
| Card edge vs page / white | 1.16 / 1.22 | 1.31 / 1.38 | 1.31 / 1.38 (`--edge-card`) |
| Header bottom line vs white | 1.22 | 1.5 | 1.50 (`--hairline`) |
| Secondary button border vs white | 1.5 | 3.28 | 3.28 (`--edge-control`) |
| Current sidebar item vs sidebar | 1.01 | white pill plus brand bar | white pill 1.22 plus 3px brand bar (8.27 on white) |
| Account menu edge vs page | 1.42 | 3.11 | 3.11 (`--edge-control`) |
| Body to meta text step | 1.1 | 1.38 | 1.38 (headings to body 1.76) |
| Progress ring track vs white | 1.5 | 3.28 | 3.28 |
| Search placeholder on the search field | 4.06 (below 4.5) | 5.26 or more | 5.26 |
| Small meta text (sidebar context, keys, kickers) | 5.0 to 5.5 | 5.26 to 6.4 | 5.26 on the sidebar, 6.09 on the page, 6.42 on white |
| Landing step numerals | 1.05 | removed | removed |

Status words after the change: success 8.21, warning 8.21, danger 8.75 on white; 7.27, 7.23 and 7.54 on their own tinted fills.

## Surface ladder

| Step | Token | Value | Job |
| --- | --- | --- | --- |
| Page | `--workspace-bg` | `#f7f9fe` | The ground everything sits on |
| Sidebar and search field | `--sidebar-bg` | `#e3e9f3` | Navigation, clearly apart from the page |
| Cards and header | `--bg-elevated` | `#ffffff` | Content and the header bar |
| Card edge | `--edge-card` | `#d3dce9` | Outline of cards, panels, the workspace switcher and the search field |
| Control edge | `--edge-control` | `#7f8faa` | Applied in this package to secondary buttons, the account menu and the ring track. Text fields and the other popovers (search results, the workspace finder, the collapsed rail's tool list, the case More panel) still use `--hairline`; see the owner calls below |

## Contrast budget

These keep the product calm as it grows. Any new screen is checked against them.

1. One dark ink block per screen. The Next Step banner is the only dark fill a person sees at once.
2. One filled accent button per region. Everything else in that region is a secondary or text button.
3. Zero counts recede. An empty count or an empty section never carries the same weight as one with something in it.
4. Edges by role. Card line (`--edge-card`), row divider (`--hairline-soft`), control border (`--edge-control`). No shadows anywhere.
5. State is never shown by hue alone. The current page has a white pill, a brand bar and a heavier weight; status has words as well as colour.

## Handed to CCD-3 and CCD-4

Seen during the scan, out of scope for a colour package (they change layout or wording), and handed to the Record (CCD-3) and Cases (CCD-4) packages:

| Page | What was seen |
| --- | --- |
| Documents | Ten equal ghost pills and a stranded Upload button |
| Dates and Expiry | The urgent appointment is the weakest block; the same paragraph appears five times |
| All Records | Six of eight cards are empty and carry the same weight as the full ones |
| History | A card inside a panel inside a card |
| Sharing | Turn Off is the loudest control on the page |
| Several pages | Disclosures with no visible marker: More Tools, Recently Turned Off, Permissions You Control, "Add the Date This Became True" |
| Several pages | Links are styled three ways; status chips differ between list and detail |

## Owner calls raised by review

These came out of the code review of this package. The values are the owner's, so none was changed without a decision.

| Item | Now | Options |
| --- | --- | --- |
| Progress ring: filled part against the empty part | 2.5:1 (was 5.5:1 accent, 4.1:1 success), because the track got darker to reach 3.28:1 on white | The ring always shows its number in text beside it, so nobody depends on the arc alone. Keep, or set the track to `--edge-card` (fill against track back above 4:1, track on white 1.38:1) |
| Text fields and the other popovers | Edges at 1.5:1 on white while secondary buttons are now 3.28:1 | Extend `--edge-control` to `.input` and the popovers in a follow-up package with its own screenshots |
| Disabled buttons | Their words use `--text-tertiary`, now darker (5.4:1 on their fill) | Disabled stays told apart by its fill and the not-allowed pointer; check with the owner when hover, pressed and disabled states are scanned |
| Phone bottom bar | The current tab keeps the thin outline it already had on main (now in `--edge-card`) | Unchanged look by decision; the brand bar and white pill do not show there |

Windows high contrast mode drops backgrounds, so the current page's bar is drawn in the system highlight colour there.

## Not covered by the scan

The platform admin console (needs a Platform Owner run), hover, pressed and disabled states (the scan read resting state) and dark mode (not shipped).
