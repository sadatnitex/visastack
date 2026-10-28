# WP-C1 colour map

Every colour the application stylesheet used before WP-C1, and what it is now. Source of truth for Harbor values: `docs/design/harbor-v2/01_tokens/HARBOR_TOKENS.json` (`semanticTokens`). Every value below was checked against that file; none differed from the plan's token map.

## Root tokens

| Token | Before | After | Harbor source |
| --- | --- | --- | --- |
| `--bg`, `--nav-material` | `#f9f8f5` | `#f7f9fe` | `bg.subtle` |
| `--bg-elevated` | `#ffffff` | `#ffffff` | `surface.elevated` |
| `--bg-subtle` | `#f0eee8` | `#edf1f5` | `state.neutral.bg` |
| `--workspace-bg` | `#fafaf7` | `#f7f9fe` | `bg.subtle` |
| `--sidebar-bg` | `#f1f3ee` | `#edf1f5` | `state.neutral.bg` |
| `--text` | `#152b37` | `#13243d` | `fg.primary` |
| `--text-secondary` | `#304450` | `#516174` | `fg.body` |
| `--text-tertiary` | `#526862` | `#596879` | `state.neutral.fg` (deviation: the plan named `fg.muted` `#647386`, which measured 4.26:1 on the neutral ground `#edf1f5` used by the sidebar and count chips; axe flagged it on six workspace screens) |
| `--accent`, `--accent-strong`, `--brand` | `#087a68` | `#1d4c98` | `brand.primary` |
| `--accent-hover` | `#075d54` | `#143b7a` | `brand.primary.hover` |
| `--brand-bg` | `#d9f3e9` | `#e8f0fc` | `selection.bg` |
| `--selected-text` | `#075d54` | `#1d4c98` | `selected.border` |
| `--hairline` | `#d8ded6` | `#cad4e2` | `stroke.default` |
| `--hairline-soft` | `#e8eae5` | `#e4e9f1` | `stroke.subtle` |
| `--success`, `--success-bg` | `#075d54`, `#d9f3e9` | `#176e52`, `#e8f4ee` | `state.success.fg`, `state.success.bg` |
| `--warning`, `--warning-bg` | `#865014`, `#fff0db` | `#92512f`, `#fbeee7` | `state.warning.fg`, `state.warning.bg` |
| `--danger`, `--danger-strong`, `--danger-bg` | `#963932`, `#b94945`, `#fbe9e5` | `#a32935`, `#a32935`, `#fbeaec` | `state.danger.fg`, `state.danger.bg` |

## New tokens (derived, reported to the owner)

| Token | Value | How derived | Used for |
| --- | --- | --- | --- |
| `--brand-tint-1` | `#f4f6fa` | brand-primary mixed into white (plan values) | very light selected or quiet panels |
| `--brand-tint-2` | `#edf1f7` | as above | notices, preparation summary |
| `--brand-tint-3` | `#e4eaf3` | as above | reserved |
| `--brand-tint-4` | `#d2dbea` | as above | identity avatar |
| `--brand-tint-5` | `#b0c0db` | as above; also 35% brand into white, the landing's dark-chapter accent | chart second series; kicker, icons and accent word on the dark sign-in panel |
| `--chapter-bg` | `#0b1a30` | Harbor `bg.chapter` | dark sign-in panel |
| `--chapter-text` | `#c2cedd` | Harbor `text.onDark.subtle` | text on the dark panel |
| `--chapter-stroke` | `#3c485a` | 20% white over `bg.chapter` | rule lines on the dark panel |
| `--chapter-stroke-strong` | `#596372` | 32% white over `bg.chapter` | footnote rule on the dark panel |

Other literals: `.btn-danger:hover` `#963932` became `#8d2836` (danger-fg darkened with 15% ink, white on it 8.44:1). The mobile "More" heading and identity rules `#5b8f83` became Harbor `stroke.strong` `#91a3bc`.

## Literals replaced by tokens

| Before | After | Where |
| --- | --- | --- |
| `#d9f3e9`, `#e0f2eb`, `#e9f3ed`, `#eaf4ee` | `var(--brand-bg)` | promise icon, light and ghost buttons, trust chips and avatar, trust feature icon, wallet selected states, beta label, mobile More panel |
| `#075d54`, `#086d5e`, `#136d5f`, `#236f59` | `var(--accent)`, `var(--accent-hover)` or `var(--selected-text)` | same places, by role |
| `#152b37`, `#18343d` | `var(--text)` | light button, mobile More summary |
| `#d1e3dd` (light) | `var(--hairline)` | ghost button border |
| `#f5f8f4`, `#f2f8f3`, `#f2f5ef` | `var(--brand-tint-1)` | trust selection, identity banner, document placeholder |
| `#e6f2e8`, `#eef6f1` | `var(--brand-tint-2)` | review note, AI notice, case notices |
| `#d6ebe1` | `var(--brand-tint-4)` | identity avatar |
| `#efefeb` | `var(--bg-subtle)` | sign-up context options |
| `#087b68`, `#c8806d` | `var(--accent)`, `var(--brand-tint-5)` | admin daily chart and legend (two series differ in lightness) |
| `#102d3b`, `#d1e3dd`, `#a5daca`, `#9ae0c9`, `#dfb0a0`, `#345651`, `#56747a` | chapter tokens and `--brand-tint-5` | dark sign-in panel |
| `#b54a3e` serif accent words | heading font, `var(--accent)` (trust hero) or `--brand-tint-5` (dark sign-in panel) | `.trust-hero h1 em`, `.auth-introduction em` |

## Outside the stylesheet

`layout.tsx` `themeColor` `#f9f8f5` became `#f7f9fe`. `agency-brand.ts` `INK` `#152b37` became `#13243d` (dark text on light agency colours).

## Survivors, by plan

Agency preset swatches (`.brand-swatch`, `branding-form.tsx`, its default) are agencies' own choices. Chart segment tokens `--seg-0` to `--seg-5` wait for a separate proposal. `#ccc` in the print stylesheet is neutral grey.

## Removed

28 old landing classes that no longer render after WP-L1 (425 lines), removed with a brace-aware prune that keeps live selectors in shared lists.

## WP-C2 surfaces and contrast (29 Oct 2026)

Owner-requested package after a measured scan of the live signed-in site (28 and 29 Oct 2026). No text failed contrast; the problem was that every surface and line sat within 1.3:1 of the next, so the app read as one pale sheet. Values below are WCAG 2.x ratios computed from the tokens.

### Root tokens changed

| Token | Before | After | Why |
| --- | --- | --- | --- |
| `--sidebar-bg` | `#edf1f5` | `#e3e9f3` | Sidebar against the page went from 1.08 to 1.16, so the two read as separate areas |
| `--text-secondary` | `#516174` | `#3b4b63` | Body text steps 1.76 below headings instead of 1.4 |
| `--text-tertiary` | `#596879` | `#4e6079` | Steps 1.38 below body text (was 1.1); 5.26 on the sidebar, 6.42 on white |
| `--success` | `#176e52` | `#0f5a41` | Status words 8.21 on white, 7.27 on their own tint |
| `--warning` | `#92512f` | `#7a3f1f` | 8.21 on white, 7.23 on its tint |
| `--danger` | `#a32935` | `#8f1f2b` | 8.75 on white, 7.54 on its tint. `--danger-strong #a32935` and the `.btn-danger:hover` literal `#8d2836` stay (palette tests pin them) |

### New tokens

| Token | Value | How derived |
| --- | --- | --- |
| `--edge-card` | `#d3dce9` | Between `--hairline-soft` and `--hairline` on the Harbor stroke ramp, chosen so a card edge reaches 1.31 on the page and 1.38 on white |
| `--edge-control` | `#7f8faa` | Darkest step on the same blue-grey axis that keeps controls quiet while meeting 3:1 for non-text edges: 3.28 on white, 3.11 on the page |

### Harbor deviations (recorded on purpose)

`--text-secondary` (Harbor `fg.body`), `--text-tertiary` (darker than Harbor `state.neutral.fg`), `--success`, `--warning`, `--danger` (Harbor `state.*.fg`) and `--sidebar-bg` (Harbor `state.neutral.bg`) are darker than the frozen reference. Reason: measured tiers 1.1 apart cannot be told apart, and status words were the weakest ink on the screen. Precedent: `--text-tertiary` in WP-C1. `docs/design/harbor-v2` is unchanged.

### Rules changed

| Rule | Before | After |
| --- | --- | --- |
| `.card` border colour | `--hairline-soft` | `--edge-card` |
| `.workspace-toolbar` bottom line | `--hairline-soft` | `--hairline` (white, 83px high, unchanged) |
| `.workspace-selector` border | `--hairline-soft` | `--edge-card` |
| `.record-search` border | `--hairline-soft` | `--edge-card` |
| `::placeholder` | browser default | `--text-tertiary`, opacity 1 (5.26 on the search field, was 4.06) |
| `.btn-secondary` border | `--hairline` | `--edge-control` |
| `.account-menu-panel` border | `--hairline` | `--edge-control` |
| `.account-menu-row[aria-current="page"]` fill | `--brand-bg` | `--brand-tint-3` |
| `.app-shell-links a[aria-current="page"]` | `--brand-bg` fill, `--hairline` edge | white pill, `--edge-card` edge, 3px `--brand` bar (hidden in the phone bottom bar; the system highlight colour in Windows high contrast mode) |
| Pressed depth switch segment, wide and phone | `--hairline` edge | `--brand` edge |
| `.progress-ring-track` | `--hairline` | `--edge-control` (3.28 on white) |
| `.land-step-num`, `.land-step > *:not(.land-step-num)` | ghost numerals at 1.05 | removed; the "Step N" kicker carries the order |
