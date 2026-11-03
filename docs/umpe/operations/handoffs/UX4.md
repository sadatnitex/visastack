# UX4 hand-back: the sidebar (no migration)

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
