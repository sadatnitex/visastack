# UX1 hand-back: the guest document desk interface (no migration)

- Branch `claude/relaxed-hamilton-632cw4` (PR 424), from main 310e6a4. Tables: none. No service, action, permission, consent or stored-value change.
- Why: the owner judged the first post-UMPE pass (a small style tweak) "1/10" and asked for a pass built on the written UI and UX standards: Harbor colours, flat surfaces, 44 px targets, one dark block and one filled button per region, honest states, plain words, and the scroll budget (task page: 3 screens).
- Standards read first: `docs/uiux/DESIGN-CONTRACT.md`, `CONTRAST-AND-SURFACES.md`, `INTERACTION-AND-STATE-MATRIX.md`, `SCROLL-BUDGET.md`, `docs/ux/plain-language.md`, `docs/ux/accessibility.md`, `docs/upgrades/programme/PROGRAMME.md` (scorecard X01 to X14), `docs/design/harbor-v2/`, UMPE master sections 6 and 9, annex F.
- What changed (`apps/web/src/app/collect/`):
  - `guest-progress.tsx` (new): the progress strip. Counts Mandatory items only; an any-one-of group counts once; says what is next; never says "You can send now" while Submit is not ready (files still being checked, or no retention period chosen). The phone's pinned summary names what needs a look first.
  - `checklist.tsx`: each line shows where it stands in words (Placed, Suggested Check It, Another Choice Placed, Still Missing) with the file under it. A file placed only from its name is a suggestion until the guest confirms it. Sections that cannot hold up a submission fold, named and one tap away. The strongest-member rule is one function shared by the section placement and the Mandatory count.
  - `guest-desk-files.tsx`: files that need the guest stay open (no item, or suggested); confirmed ones fold; the old separate Still Missing list is gone (each line says it).
  - `fold.tsx` (new): one native disclosure with a visible marker, a status line and a heading when it carries one.
  - `page.tsx`, `retention-choice.tsx`: two columns on desktop (checklist; one side column to add, place and send), agency accent and tint through the existing brand scope, retention as seven even tiles, nothing preselected, folded once chosen; with uploads off the retention choice stays where it was.
  - `globals.css`: one block, `WP-UMPE-UX1`, one rule per selector, tokens only, no shadows (the flat-design check passes).
- Measured on the real page with synthetic data (server markup, real stylesheet, Chromium; phone 390 wide, screen 844; desktop 1280 wide, screen 800). Main before, then this change:

| State | Phone before | Phone now | Desktop before | Desktop now |
|---|---|---|---|---|
| Nothing added yet | 3,268 px, 3.87 | 2,505 px, 2.97 | 2,800 px, 3.50 | 1,795 px, 2.24 |
| Every Mandatory item placed | 3,953 px, 4.68 | 2,462 px, 2.92 | 3,254 px, 4.07 | 1,626 px, 2.03 |
| Part way (two files need a look, retention open) | 4,296 px, 5.09 | 3,210 px, 3.80 | 3,498 px, 4.37 | 2,396 px, 3.00 |

- Budget: desktop is within 3 screens in all three states. Phone is within 3 screens in two states and over in the part-way state (3.80). The page was already over on a phone before this change in every state; the part-way state is the one that stays over. What would close it is a behaviour change, not styling: choosing a file for an item from the item's own line, so the separate file cards disappear. That is parked for an owner decision.
- Tests: `guest-progress.test.tsx` (new, 21 tests: what counts as Mandatory, groups, strip wording and blockers, each line state, folds, files). Proven red by breaking the Mandatory rule on purpose (5 failed), then restored. Existing guest desk tests (37, all 58 in the folder pass), title-case, vocabulary and plain-language guards pass. axe (WCAG 2.2 AA and best practice) found no violation in 3 states at 2 widths with every fold opened.
- Reviews: `/code-review high` on the diff gave 9 findings; 7 fixed (agency-added Mandatory item hidden in a fold, strip promising a send the button refused, fold count wrong for a covered choice, suggestions needing no look, duplicated group rule, dead and duplicate CSS, brand scope declared inside the page function); 1 not applicable (an unreadable checklist never shows the upload area); 1 accepted (the old Still Missing list is replaced by the line states). `/security-review`: not run, the change moves no data and adds no action; design review skills: accessibility checked with axe above, not with the review skill.
- Not verified: a signed-in or live guest session (the real page was rendered from server markup with made-up data, not through a deployment); a screen reader and a real phone; dark appearance (not shipped); the other UMPE screens (agency requests queue, trips, traveller Home), which have approved concepts but no code yet.
- Open for the owner: the part-way phone height above; whether the agency's main menu name "Document Requests" is wanted (concept only).
