# Session handoff, 27 October 2026 (evening)

For the session that takes over the Small Commercial V1 track while the first session finishes the Growth track. Read CLAUDE.md first, then only the sections below.

## 1. Split of work

| Track | Owner session | Packages |
|---|---|---|
| Small Commercial V1 | new session | S13 to S16 (AI connector sign-in server, connector route, screens, audit), S17 and S18 (held-payment tools), S20 to S22, S23 (redaction, ADR 0022), S27 (readiness reconciliation), S24 prepared only |
| Growth | first session | G11, G9a, G6 (in flight), then G4, G7, G8b, G12, G13, G14, G15, G10 |

Not to start: S25 (Bangla). S19 only after the owner names the payment provider. S24 (final release candidate) is never merged without the owner's explicit word.

## 2. Already live on main (do not rebuild)

S2 version binding and staff scopes, S3 staff authenticator codes (`STAFF_SECOND_FACTOR=off|required`, default off), S4 scanner evidence, S26 key service (AWS KMS provider, off until owner step O16), S5 and S6 automatic reading, S7 request screens, S8 and S9 selected output engine, Briefs and Summaries, S10 invoice ledger, S11 payments (SSLCOMMERZ, off), S12 agency invoices, manual payment claims and receipts, Growth G1, G1b, G2, G3, G5, G8a, the collapsible sidebar, the compact account menu, and the Time Zone dropdown.

## 3. Rules that save a red cycle

- Package plan: docs/roadmap/SONNET-SMALL-COMMERCIAL-V1-HANDOFF.md (section M order). Frozen contracts: ADR 0019 to 0022. Owner actions never block building: build with test doubles and a switch that defaults off.
- Migrations: this session range is 0100 and above. The first session owns 0098 (weekly file note) and 0099. Always re-runnable (IF NOT EXISTS, DO $$ guards). Code must tolerate a missing table (`missing-relation.ts`). db-migrate.yml runs from main only, input confirm="migrate", after the merge.
- Check slot: run `scripts/agent/full-check.sh <worktree> <logdir>` once per package with `PORT=3104` in your own scratch folder. Never share a scratch folder with another session or helper (a helper once overwrote another's script).
- Stylesheet: `apps/web/src/app/globals.css` merges are append-only. On a conflict take main's file and re-add only your own block, which starts with a `/* WP-<ID> ...` marker. A guard test must find its block by its marker and must not pin the next marker.
- Shared files that conflict often: globals.css, product-events.ts and its test (closed event names, categories, admin scorecard label map), services `index.ts`, `enforcement-baseline.json` (sorted), `plain-language.test.ts` PUBLIC_FILES, e2e specs.
- Route-link check: links built only through a helper function are invisible to `scripts/check-route-navigation.mjs`. Write the path as a literal template in the component.
- Supply-chain scan flags `.exec(` on a regex as shell execution. Use `String.prototype.match`.
- Squash merges: after each squash merge origin/main into your branch. If a file shows no removed lines against main, take yours; otherwise merge by hand. Push only the verified commit to the designated branch, never force.
- Interface words: Title Case labels, "case" never "mission", no approval wording about readiness, no em dashes.

## 4. How a package runs

1. Plan note in 3 bullets, then build in a worktree.
2. /code-review high (max for auth, documents, sharing, payments, deletion), /security-review where personal data or auth is touched.
3. Prove each new guard can fail by breaking the real code once.
4. One full check, read only summary.txt.
5. Push, draft PR using the template headings, unsubscribe from PR events, one background loop on the three required checks for the head SHA.
6. Mark ready, squash merge with the expected head SHA, then `scripts/agent/wait-deploy.sh <full sha>` and `/api/health/ready`.
7. Report to the owner in plain words: table (Area | What changed | What you will see | Who notices), then Checked live, Not live yet, Not yet checked, Needs you.

## 5. Open owner steps (never block on them)

- O16 AWS KMS values; SSLCOMMERZ sandbox account and field-name check; staff authenticator rollout (`STAFF_SECOND_FACTOR=required` after staff enroll); Google and phone sign-in providers; WhatsApp business templates; `AUTH_EMAIL_CODE=on` after a test code; dismiss the two CodeQL alerts about the payment signature hash that the provider requires.
- Decisions waiting: how a document with no kind is read, whether the same transfer entered twice counts twice, resend path for a received request whose file is later blocked, whether all 30 Schengen public pages stay indexable.
- Password reset email: cause not found from read-only data. Waiting for the owner to say which address was typed, what the email service log shows, and whether it landed in spam.

## 6. Pitfalls seen this session

- Containers restart: local-only lanes vanish. Push or tell the owner.
- Stop hook needs a clean tree and warns on unpushed commits; push only after local verification is complete.
- Pixel tests tolerate at most 6 per-channel levels of noise and wait for animations to finish; do not tighten them.
- Do not use `pkill -f`; it can kill your own shell. Kill by process group id.
