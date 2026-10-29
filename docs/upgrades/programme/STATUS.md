# Programme X status

Keep this file between 250 and 400 words. Memory between sessions; evidence lives in `COVERAGE-LEDGER.csv`. Overwritten each time; history stays in git.

- Last updated: 28 October 2026: Calm Core With Depths (CCD) complete, CCD-0 to CCD-7 merged and live; WP-C2 surface and contrast layer merged with the owner's word (#332)
- Current main: `0ddb67f2` (CCD-7b, #335)
- Merged this run: CCD-5 Notifications and Privacy (#325), Evidence Requests and Sharing (#326), the Next Step banner in the brand ink (#327, #328), time zone pickers and filterable logs (#329), designed emails (#330), CCD-6a Agency Overview (#331), CCD-6b Agency Cases (#333), CCD-7a one name per thing (#334), WP-C2 contrast (#332), CCD-7b experience behaviours (#335)
- WP-C2: sidebar and page, card edges, control edges and the text tiers now separate by tone and edges only; status words and two text tiers are darker than Harbor on purpose (`colour-map.md`, section WP-C2)
- Migrations: up to 0101 in the repository (0098 and 0099 unused), none pending at the 29 Oct readiness check. Next number: 0102 (S23, in progress). Corrected 29 Oct: S11 (0096) and S12 (0097) merged 27 Oct
- CCD-7 widths: 824 rendered pages at 390, 768 and 1280 show no sideways scroll (checker seen catching a wide page). Small Commercial order: `docs/roadmap/SONNET-SMALL-COMMERCIAL-V1-HANDOFF.md` section M. WP-C2 hands its layout findings (empty sections, one primary button per region, a quieter Turn Off, visible disclosure markers) to the Record and Cases depth work
- Owner steps still open: O16 AWS account for the key service; turn on staff codes when staff have enrolled; keep click and open tracking off for the sending domain in the email service (invitation links carry one-time codes)
- Known weakness: the live pixel-identity browser test has failed once and passed on its re-run on two deploys; being hardened
- Not verified live: signed-in look of the CCD screens and of WP-C2 at phone and desktop widths (needs a signed-in run); the platform admin console; hover, pressed and disabled states; any real AWS, payment or AI provider call
- Blockers: none
- Next action: Small Commercial S23 (section M; S11 and S12 are merged); owner calls from the WP-C2 review are listed in docs/uiux/CONTRAST-AND-SURFACES.md

## How to update

After every package: update every line above with exact checks and outcomes on the current head SHA. Say "not verified" where that is the truth.
