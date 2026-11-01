# Programme X status

Keep this file between 250 and 400 words. Memory between sessions; evidence lives in `COVERAGE-LEDGER.csv`. Overwritten each time; history stays in git.

- Last updated: 1 November 2026: Scroll Budget complete in code, WP-SB0 to WP-SB9 merged and live, WP-SB10 makes every scroll-budget check enforce (this PR)
- Current main: `1f2f2e9b` (LC-A1, #395), merged into WP-SB10; sweep measured on `3535437e`
- Merged this run: WP-SB0 (#378), SB2 (#383), SB3 (#385), SB9 (#386), SB1 (#387), SB4 (#384), SB7 (#390), SB8 (#391), SB5 (#392), SB6 (#394). Earlier: CCD-0 to CCD-7 and WP-C2 (#325 to #335)
- WP-C2: sidebar and page, card edges, control edges and the text tiers now separate by tone and edges only; status words and two text tiers are darker than Harbor on purpose (`colour-map.md`, section WP-C2)
- Migrations: up to 0113 in the repository (Resource Lifecycle); Scroll Budget added none. Pending state not checked by WP-SB10
- CCD-7 widths: 824 rendered pages at 390, 768 and 1280 show no sideways scroll (checker seen catching a wide page). WP-C2 layout findings (empty sections, one primary button per region, a quieter Turn Off, visible disclosure markers) go to the Record and Cases depth work
- Scroll Budget: 53 browser checks pass locally, enforced by default and run in CI. Four reported exceptions, phone unless noted: Documents 3.5 screens (budget 3), Agency Clients 4.22 (desktop 3.64), Agency Dashboard table 3.1, open case snapshot 5.92 (budget 2). Heights of 1,246 rendered pages: `docs/uiux/SCROLL-BUDGET.md`, with 27 test files to triage
- Owner steps still open: O16 AWS account for the key service; turn on staff codes when staff have enrolled; keep click and open tracking off for the sending domain in the email service (invitation links carry one-time codes)
- Known weakness: the live pixel-identity browser test failed once and passed on re-run on two deploys; being hardened
- Not verified live: signed-in pages at phone and desktop widths (CCD, WP-C2, every Scroll Budget page); the platform admin console; hover, pressed and disabled states; any real AWS, payment or AI provider call
- Blockers: none
- Next action: Small Commercial order in `docs/roadmap/SONNET-SMALL-COMMERCIAL-V1-HANDOFF.md` section M; a layout package for the four Scroll Budget exceptions and the triage list

## How to update

After every package: update every line above with exact checks and outcomes on the current head SHA. Say "not verified" where that is the truth.
