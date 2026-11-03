# UX4 hand-back: the sidebar and the page edges (no migration)

- Owner report (photo of a laptop screen, 3 Nov 2026): the menu was too big, needed a lot of scrolling, and its arrangement did not look right. Rendered first with the real shell.
- What the real sidebar did: 818 px of content with More Tools closed (1,094 px open), so it scrolled by 218 px at a 600 px window, 138 px at 680 and still 18 px at 800. The brand took 103 px (the mark above the wordmark), the two tasks (Add Documents, Start a Trip) were two extra indented blue rows at different offsets (92 px), and the "You Control Access" card took 82 px.
- What changed (`apps/web/src/app/app/app-nav.tsx`, one `WP-UMPE-UX4` block in `globals.css`):
  - The brand is one row (mark and wordmark side by side) with the hide-menu button at its end.
  - Each task is a small icon button at the end of its destination's row (upload on My Documents, plus on My Trips), 44 px, with its words for a screen reader and as a tooltip. One row per destination now.
  - A hairline sets the utilities (Notifications, Countries) apart from the three places; Home, My Documents, My Trips and Sharing & Requests keep their order.
  - On a short window (780 px or less) the reassurance card gives way, and at 640 px or less the small Workspace caption does too.
  - A phone is unchanged: the wrapper steps aside and the tasks still lead the More panel.
- Measured on the real shell with made-up data, More Tools closed: content 818 px to 556 px at a 600 px window (scrolled 218, now fits), 818 to 636 at 680 (scrolled 138, now fits), 818 to 756 at 800 (scrolled 18, now fits). Agency and platform menus share the one-row brand and the height trimming but have no tasks and no hairline.
- Tests: 2 new (a task sits inside its destination's row after it, with a spoken name and a tooltip; a destination with no task gets no wrapper); proven red by renaming the wrapper, then restored. The navigation, parity, shell and surface tests pass (58 plus the 13 in the nav file). Lint, the flat-design check, the supply-chain scan and typecheck pass.
- Not verified: a real laptop and a screen reader (the icon buttons rely on their spoken names), the collapsed rail (tasks stay hidden there as before), a window under 560 px high, dark appearance, and the e2e browser checks that measure the sidebar (CI runs them).

## Page edges (owner photos of Group Trips, 3 Nov 2026)

- Two photos showed the Group Trips page with its title, description and empty card flush against the sidebar and the "Start a Group Trip" button touching the right edge of the window. Measured on the real page before the change: title 0 px from the sidebar, button 0 px from the window edge.
- Cause: five signed-in pages return a header and cards with no page gutter (`section container`), where every other page has one: Group Trips (list), one trip, New Group Trip, Start a Trip, and the sharing-invitation accept page (which had `section` without `container`). Correction to my earlier UX2 renders: they wrapped the trip page in a gutter the real page did not have, so the real trip pages ran to the edge until now.
- Fix: `app/app/trips/layout.tsx` and `app/app/mission/start/layout.tsx` supply the gutter (and cover their loading screens); the accept page gets `section container`. After: about 103 px from the sidebar and from the window edge at a 1,366 px window, as on every other page.
- Guard: `lib/page-gutter.test.ts` reads every page under `app/app` and fails when one has no gutter, itself or in a layout above; proven red by removing the trips layout (it names the three trip pages), then restored.

## Review of the sidebar change (`/code-review high`)

6 findings, all fixed: the Staff Mode cue is never hidden on a short window (only the customer reassurance gives way, and Staff Mode loses just its small line); the hairline appears only when the utilities exist; the task's name shows on hover and keyboard focus (and is its spoken name) instead of a mouse-only tooltip; the row's reserved width and the button share one custom property; the shared `sr-only` is no longer duplicated; a stylesheet guard (`lib/sidebar-css.test.ts`, 7 tests) now covers the phone fallback, the collapsed rail, the focus label and the Staff Mode rule.

