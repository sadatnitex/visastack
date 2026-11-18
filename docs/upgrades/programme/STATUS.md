# Programme X status

Keep this file between 250 and 400 words. Memory between sessions; evidence lives in `COVERAGE-LEDGER.csv`. Overwritten each time; history stays in git.

- Last updated: 18 November 2026 (documentation sync). Replaces the 1 Nov view (Scroll Budget WP-SB0 to WP-SB11, CCD and WP-C2, all merged and live; history in git)
- Current main: `769e43ea` (MOT1, #651, deploy being verified); `00c01849` (U7, #650) deploy verified (Vercel, Deploy Smoke, Playwright Deploy Smoke, live signed-in check, CI, CodeQL)
- Wallet upgrade, merged and live: WAL1 (#631), WAL9 (#633), WAL1B-1 (#634), WAL1B-2 (#638), WAL5 (#636), WAL4 (#637), WAL2 (#639), WAL3 (#640), WAL10 (#643), U8 (#644), U6 (#647), FIX9 (#648), U7 (#650). Records: `wal/`. Foundation: ADR 0030
- Public site, merged and live: PUB1 (#623), PUB2 (#626), PUB3 (#628), HOT1 (#629), PUB4 (#630), PUBFIX (#635), R1 (#641), R4 (#642), R5 (#645), R2 (#646), R3 (#649). Records: `pub/`. ADR 0029
- Merged, not yet checked live: MOT1 (#651, `769e43ea`)
- Running now: NAV2 (`claude/nav2-header-footer`); PUB5 verification lane idle; PR #581 (Bengali refill 7) stale
- Owner decisions in force: Profile "B Passport Page Card"; Document detail A+B; Trip Package "-A"; AI Connections "- A"; tab name "My Record"; gentle fades for reduced motion, full motion for everyone else
- Migrations: none added by these units; next free number 0138
- Not verified: real-device checks of the switched-off features; a human signed-in click-through (CI guard covers made-up people only)
- Blockers: none
- Next action: NAV2 merges, then the public-site verification pass; follow-up list in `SESSION-HANDOFF-2026-11-18.md`

## How to update

After every package: update every line above with exact checks and outcomes on the current head SHA. Say "not verified" where that is the truth.
