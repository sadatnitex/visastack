# Programme X status

Keep this file between 250 and 400 words. Memory between sessions; evidence lives in `COVERAGE-LEDGER.csv`. Overwritten each time; history stays in git.

- Last updated: 28 October 2026: Calm Core With Depths (CCD) CCD-0 and CCD-1 built on a draft pull request; Small Commercial V1 packages S1 to S10 and S26 are merged and live
- Current main: `0f22d2c0` plus the PWA and WhatsApp channel work from another session (#288, `dca3e974`)
- Packages merged this run: S2 #283, S3 #284, S4 #285, S26 #286, S10 #287, S5 and S6 #289, S8 and S9 #290, S7 #291. S1 was #281
- Migrations applied on Neon: 0092 staff codes, 0093 key wrapping, 0094 payment ledger, 0095 WhatsApp channel. Next free number: 0096 (reserved for S11 online payments)
- In progress (saved in worktrees, resumed): S11 online payments (SSLCOMMERZ, off until the owner has an account), and the collapsible desktop sidebar with a fitting account menu
- Next in order: S12 agency invoices and receipts, then S13 to S16 AI connector core, S17 and S18 recurring billing and refunds, S20 to S22 connector extensions, S23 redaction, S27 readiness reconciliation, S24 acceptance (never merged without the owner's word). S19 and S25 wait for the owner
- Owner steps still open: O16 AWS account for the key service; turn on staff codes (`STAFF_SECOND_FACTOR=required`) when staff have enrolled
- Known weakness: the live pixel-identity browser test (`ux-public` "authoritative appearance") failed on two deploys and passed on its re-run; being hardened
- Defaults to confirm: documents with no chosen kind are read by AI only on request; one bank transfer entered twice under different keys counts twice
- Not verified live: signed-in look of the new screens at phone and desktop widths; scanning shows unconfigured until the next scheduled scan records its proof; any real AWS, payment or AI provider call
- CCD (28 Oct): switch, memory, link reveal and nothing-lost test built; Account screen done; screens 02 to 15 are CCD-2 to CCD-7. Needs the owner's merge word. Ranking rules R1 and R2 need new reads
- Blockers: none
- Next action: merge the sidebar and account-menu PR, then S11 on 0096, then S12

## How to update

After every package: update every line above with exact checks and outcomes on the current head SHA. Say "not verified" where that is the truth.
