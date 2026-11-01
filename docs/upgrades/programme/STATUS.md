# Programme X status

Keep this file between 250 and 400 words. Memory between sessions; evidence lives in `COVERAGE-LEDGER.csv`. Overwritten each time; history stays in git.

- Last updated: 1 November 2026 (documentation handover): Scroll Budget complete, WP-SB0 to WP-SB11 merged and live
- Current main: `b665fd4e` (#404); main CI, CodeQL and the Vercel status succeeded on it
- Merged this run: WP-SB0 (#378), SB1 (#387), SB2 (#383), SB3 (#385), SB4 (#384), SB5 (#392), SB6 (#394), SB7 (#390), SB8 (#391), SB9 (#386), SB10 (#397, every check enforces), SB11 (#402, three exceptions fixed). Earlier: CCD-0 to CCD-7 and WP-C2 (#325 to #335)
- WP-C2: sidebar and page, card edges, control edges and the text tiers separate by tone and edges only; status words and two text tiers are darker than Harbor on purpose (`colour-map.md`, section WP-C2)
- Migrations: Scroll Budget added none. Production has every migration through 0114 applied; none pending (readiness `ready`, 1 Nov)
- CCD-7 widths: 824 rendered pages at 390, 768 and 1280 show no sideways scroll. WP-C2 layout findings (empty sections, one primary button per region, a quieter Turn Off, visible disclosure markers) go to the Record and Cases depth work
- Scroll Budget: every browser check enforces and runs in CI. No known exception remains: lane Z (#403) fixed the last one, Documents on a phone, with 6 rows a page (2.40 screens against 3). Heights and the triage list of 27 test files: `docs/uiux/SCROLL-BUDGET.md`
- Owner steps still open: O16 AWS account for the key service; turn on staff codes when staff have enrolled; keep click and open tracking off for the sending domain in the email service (invitation links carry one-time codes)
- Known weakness: the live pixel-identity browser test failed once and passed on re-run on two deploys
- Not verified live: signed-in pages at phone and desktop widths (CCD, WP-C2, every Scroll Budget page); the platform admin console; hover, pressed and disabled states; any real AWS, payment or AI provider call
- Blockers: none
- Next action: no Programme X package is open. Next engineering item is the faster-tests work in `docs/SESSION-START.md` section 7; the Scroll Budget triage list stays available

## How to update

After every package: update every line above with exact checks and outcomes on the current head SHA. Say "not verified" where that is the truth.
