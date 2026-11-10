# Tokens and components

Implementation: `apps/web/src/app/globals.css`, `components/ui.tsx`, `components/icons.tsx`, `app/app/app-nav.tsx`, `app/auth/auth-ui.tsx`.

| Role | Light | Dark |
| --- | --- | --- |
| Page | #F9F8F5 | #102937 |
| Content | #FFFFFF | #183844 |
| Secondary surface | #F0EEE8 | #203F4A |
| Text | #152B37 | #F9F8F5 |
| Secondary text | #304450 | #D1E3DD |
| Supporting text | #526862 | #B4CDC5 |
| Action | #087A68 | #075D54 |
| Link / focus | #087A68 | #9AE0C9 |
| Selected | #D9F3E9 | #254B48 |
| Display emphasis | #B54A3E | #F5B4A5 |

Supporting text is darker than the reference muted #82908E for normal-text contrast. Controls use the stronger supporting border, while decorative card boundaries retain subtle hairlines. Warning text #865014 is derived from the reference amber for readable normal text. Dark colors derive from the supplied navy/mint palette. Contrast measurements and browser findings are recorded in the accessibility report, not inferred from this table.

Radii: 10 / 16 / 22px plus pills and circular avatars. Spacing retains existing 4/8/12/16/24/32/48/64px rhythm. Actions and principal controls have 44px targets. Existing lightweight line icons and self-hosted lawful fonts are reused.

Existing shared components cover page headings, next action, notices, status, metrics, lists, tables, forms, disclosures and empty/loading states. The actual shared authentication shell and workspace toolbar are updated. DocumentReviewPanel renders authorized metadata only and submits the existing preview action; it never embeds unchecked document bytes. Sharing presents existing grants before the existing grant form.

Refinement: light success text is #075D54 on #D9F3E9, and danger text is #963932 on #FBE9E5. White action text retains its accessible solid fills. Document search filters only the already-authorized metadata passed by the existing owner-scoped page. No search endpoint or wider data query is introduced. Safety badge tones come from the page's existing safety-label mapping; search never turns a blocked document into an available preview.

Selected navigation and registration labels use the separate selected-text token (#075D54 light, #9AE0C9 dark) on the selected mint surfaces. Icons retain their existing accent; text is evaluated at the normal-text threshold.

## Approved appearance correction, 2026-10-11

Remove both automatic prefers-color-scheme dark override blocks. Keep color-scheme light and a fixed paper theme color. Separate paper public background, white surfaces, #fafaf7 workspace content and #f1f3ee sidebar. Retain deliberate #102937/#183844 navy accents, teal actions, mint selection and rust serif headlines. Shared AuthShell, AppNav, WorkspaceToolbar, SiteNavigation and trust story translate the original desktop proportions into purposeful tablet/phone reflow. No alternate dark theme is provided.

## One list pattern, 9 Nov 2026 (case page plan, sections 8 and 10)

Every list screen is built from `apps/web/src/components/list-pattern/`: `ListRow` (a status glyph, a name cut to twelve words, one chip, at most one action), `GroupedList` (folders with a Title Case header and a count, the first rows shown and the rest under "n More Items", stable ids), and `ListWithPane` (the panel a row opens: Back, Esc and the browser's Back close it, focus returns to the row, a link with `?item=<id>` opens it at once). The look lives in one block of `globals.css` (`WP-LP1`) and is held by `lib/list-pattern-css.test.ts`; the use of the kit is held by `lib/ccd/pattern-registry.ts` and `pattern-conformance.test.tsx`.

- Row: minimum height 56px on every width; one line of name, cut with an ellipsis and marked `data-value`, the full sentence in the panel and in the link's accessible name; at most one meta line; the leading mark is the status glyph in a circle (no tile); a file-kind icon appears only on the Documents list.
- Chip: the word comes from `lib/status-words.ts` (Missing, Two Values, Out of Date, To Confirm, Optional, On File, Not Applicable, Covered by Another Option, Received). Green, amber and red are states; blue is Received and is never green.
- Folder header: Title Case, with the count of rows, an `h4` inside the opener of a native fold. A folder with no rows is not drawn.
- Panel: wide screens, it takes the side column (24rem, 384px) and the rail steps aside; at 1180px and below it is a full screen (no dimmed backdrop, because translucent surfaces are not allowed) with one way back and the page behind it locked. 1px border, no shadow.
- Buttons: the page's one filled button is the Next Step. A row action is a secondary 14px button, 44px high. The panel's save buttons are secondary unless one is the page's only primary.
- Adding a file: a new file is added on the Documents page. The panel's Add button goes there; "Provide Evidence" chooses among files already on file.

## The visual language: things talk loudly, 10 Nov 2026 (owner decision, P13)

Owner, 10 Nov 2026, approving the visual language "better aligned with our color theme": things "talk loudly ... like flags, it instantly says what it is without reading; appropriate symbols, icons, art, imagery within our UI/UX and design system make the entire system far more intuitive and self-explanatory". This supersedes the 9 Nov line above that says "the leading mark is the status glyph in a circle (no tile); a file-kind icon appears only on the Documents list". The 9 Nov text stays as history.

- Where it lives: `lib/item-icons.ts` is the one map (document kind, trip purpose, status word to symbol and tone); `components/mark-tile.tsx` draws a flat line icon in a soft tone tile; `components/empty-art.tsx` draws the three small empty-state drawings; `components/purpose-select.tsx` shows the chosen purpose beside the native list. Screens ask the map; they never choose a symbol or a tone themselves. The style is the `WP-P13` block of `globals.css`, held by `lib/item-icons.test.ts`.
- A row's leading mark is the kind of item in its tone tile (a passport, a bank statement, a detail from the profile). The status shows in the chip, which wears its own symbol (done, needs you, needs a check, waiting, received, locked). A row with no kind keeps the status glyph. The tile is 32px, the size of the glyph it replaces, so the 56px row does not grow.
- The icon is hidden from screen readers; the plain word beside it is the name. One symbol, one meaning, the same on traveller and agency screens: the test fails if a document kind, a purpose and a status share a symbol, except the two named in `SHARED_ON_PURPOSE`.
- Colour: only the six Harbor tones of `WP-PLAIN-TONE`. Green, amber and red are state; blue, violet and teal are kind (identity blue, money teal, papers violet). Grey is the neutral token. The new style block may not contain a colour value, a gradient or a shadow; the test fails if it does.
- Countries are always flags (the shared country flag of P12); a purpose has its own symbol beside the flag. Agency and contributor screens use the same flag (P16): the agency Cases list rows and open case workspace, the agency Home case table, the Document Requests list and request page, and the contributor answer pages draw `DestinationLabel` (a request keeps a two-letter code, so the page passes `destinationName(code)`). A name or code the country list does not hold is written as it is with no flag.
- Purpose pictures (P15): a Trips card and the case page header draw the purpose's picture (`savedPurposeMark` in `lib/case-choices.ts`, from the purpose label the case saved) in front of the purpose word, hidden from screen readers; a saved purpose the picker does not offer gets no picture. Start a Trip and Start a Group Trip open "Why?" on eight picture tiles that are real radio buttons (`components/purpose-choice.tsx`, keys in `lib/common-purposes.ts`) with a More Purposes tile that swaps in the full grouped list. Same field (`purpose`) and values as before. The style is the `WP-P15` block of `globals.css`, held by `lib/purpose-tiles-css.test.ts`.
