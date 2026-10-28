# Programme X status

Keep this file between 250 and 400 words. Memory between sessions; evidence lives in `COVERAGE-LEDGER.csv`. Overwritten each time; history stays in git.

- Last updated: 29 October 2026: WP-C2 surface and contrast layer built on a draft pull request; Calm Core With Depths (CCD) slices up to 6a merged and live
- Current main: `5a8f4370` (CCD-6a Agency Overview, #331)
- Merged this run: CCD-5 Notifications and Privacy (#325), Evidence Requests and Sharing (#326), the Next Step banner in the brand ink (#327, #328), time zone pickers and filterable logs (#329), designed emails (#330), CCD-6a (#331)
- In review, not merged: WP-C2 (owner's merge word needed). Sidebar and page, card edges, control edges and the text tiers now separate by tone and edges only; status words and two text tiers are darker than Harbor on purpose (`colour-map.md`, section WP-C2)
- Migrations applied on Neon: up to 0095. Next free number: 0096 (reserved for S11 online payments)
- Next in order: CCD-6b Agency Cases, then CCD-7 naming, accessibility and copy pass; then S11, S12 and the rest of the S-list. WP-C2 hands its layout findings (empty sections, one primary button per region, a quieter Turn Off, visible disclosure markers) to the Record and Cases depth work
- Owner steps still open: O16 AWS account for the key service; turn on staff codes when staff have enrolled; keep click and open tracking off for the sending domain in the email service (invitation links carry one-time codes)
- Known weakness: the live pixel-identity browser test has failed once and passed on its re-run on two deploys; being hardened
- Not verified live: signed-in look of the CCD screens and of WP-C2 at phone and desktop widths (needs a signed-in run); the platform admin console; hover, pressed and disabled states; any real AWS, payment or AI provider call
- Blockers: none
- Next action: owner reads the WP-C2 screenshots and gives the merge word; meanwhile build CCD-6b

## How to update

After every package: update every line above with exact checks and outcomes on the current head SHA. Say "not verified" where that is the truth.
