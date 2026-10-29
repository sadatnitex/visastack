# VisaStack: start here (every session)

Read this once at the start of a session, then only what your task needs. `CLAUDE.md` (loaded automatically) holds the standing rules; this page is the full picture behind them, for any task, inside or outside Programme X. Last updated 29 October 2026. When something here is out of date, fix this page in the same PR.

## 1. What VisaStack is

An invite-led visa-document platform (public beta, free, at your own risk, controlled pilot with made-up records only; real applicant data is switched off). A traveller keeps one personal record (profile, documents, dates) and reuses it for every visa case; AI suggests details that a person approves; agencies see only what they are given; every action is permission-checked, consent-gated and audited. The owner is a non-technical founder who thinks in systems and strategy: tell them what changed, what they will see and who notices, in plain words.

Production: https://vs.obsidianglobal.studio (fallback https://visastack-five.vercel.app). Deploys from `main` only; pull requests get no preview.

## 2. Where things are

| Need | Where |
|---|---|
| Current product state, what is live and what is open | `docs/public-beta/CURRENT-STATE.md` (newest dated section wins) |
| Setup facts, environment, providers | `docs/operations/current-platform.md` |
| Small Commercial V1 plan and package status (S1 to S27) | `docs/roadmap/SONNET-SMALL-COMMERCIAL-V1-HANDOFF.md` (section M is the status table); deferred security and compliance controls: `docs/roadmap/DEFERRED-COMMERCIAL-HARDENING.md` |
| Owner actions (pending and done, with where the owner does each) | `docs/roadmap/OWNER-ACTIONS-SMALL-COMMERCIAL-V1.md` |
| Programme X and Calm Core With Depths (CCD) status | `docs/upgrades/programme/STATUS.md`, then `PROGRAMME.md`, `WORK-PACKAGES.md` (your package only), `allowlists/<package>.txt`, `COVERAGE-LEDGER.csv` |
| Latest session handoff (open branches, decisions, pitfalls) | newest `docs/upgrades/programme/SESSION-HANDOFF-*.md` |
| Functional spec v1.2 | `docs/upgrades/upgrade.v1.2.execution.md` (grep the U/E/B/T/R id) |
| Decisions and their reasons | `docs/adr/` (0015 agency Do Next ranking, 0016 Needs Attention and calendar, 0017 per-case sharing exceptions, 0018 visible reference codes, 0019 automatic document reading, 0020 invoice payments (SSLCOMMERZ plus verified manual payments), 0021 AI Context Gateway (AI app sign-in and the read-only connector), 0022 real redaction (safe copies with masks), 0023 Calm Core With Depths (Glance, Browse, Everything)) |
| Interface style every new build follows and extends | ADR 0023; `docs/uiux/ccd/VOCABULARY.md` (one name per thing); `docs/uiux/ccd/PARITY-LEDGER.md` (nothing lost, held by `apps/web/src/lib/ccd/parity-*.test.tsx`); `docs/uiux/CONTRAST-AND-SURFACES.md` (surfaces and contrast, WP-C2) |
| Permission rules | `docs/architecture/permission-model.md`; code in `packages/policy` and `packages/services/src/access/` |
| Evidence log (append-only, thousands of lines) | `docs/commercial-v1/known-issues.md`: grep, never read whole |
| Requirement status | `docs/commercial-v1/requirements-ledger.md`: grep the row id |
| Visual reference | `docs/design/harbor-v2/` (immutable), `docs/uiux/PDF-TO-FUNCTION-MAPPING.md` |
| Legal drafts for the owner | `docs/legal/` (reviews, not advice; no compliance claims) |
| Runbooks | `docs/operations/runbooks/`, `docs/operations/backup-resurrection-reconciliation.md`, `docs/operations/r2-encrypted-backups.md` (daily backup, freshness check, pruning) |
| Agent scripts | `scripts/agent/` (full check, CI and deploy waits, merge helpers) |

Code: `apps/web` (Next.js 15.5, React 19), `packages/services` (all business logic, transactional, audited), `packages/policy` (default-deny rules), `packages/db` (drizzle schema and migrations), `packages/core` (pure shared logic, for example `@visastack/core/calendar`), `packages/adapters` (storage, scanning, AI providers, image processing). Tests use PGlite through `createMigratedPglite()`.

## 3. Standards (what "done" means here)

- **Power-first, production quality.** Build the most capable, scalable option; never a prototype unless the owner says "quick prototype". Flag real trade-offs; flag anything hard to reverse before building.
- **Security that never adds needless friction.** Every applicant read goes through the central gate (`requireAccess`); new exported service functions that read applicant data take its proof (a ratchet test forbids new ungated reads). Fail closed. A denied lookup looks exactly like a missing one. Audit every mutation; audit records hold counts and kinds, never personal content.
- **Truthful wording.** Received is not Reviewed; Suggested is not Confirmed; Saved is not Shared; never claim acceptance, approval odds or compliance. Plain English, no engineering words in the interface.
- **Interface rules (guard tests enforce them).** Title Case for every name (buttons, headings, labels, badges); the word "case", never "mission", in visible text; flat design (no gradients, shadows or translucent surfaces outside the landing); 44px targets; no button disabled while busy (`aria-disabled`); every exported form rendered in the accessibility test; CSS changes as a new block at the end of `globals.css` starting `/* WP-<ID>`; icons are same-site files (the security policy blocks `data:` images).
- **No em dash anywhere** (code, docs, commits, PR text, chat). Build such characters from code points in tests.
- **Durability and flexibility.** One rule in one place (no hand-copied variants); permanent formats (calendar UIDs, reference codes, migration numbers) are decided once and documented in an ADR; integration points are typed ports, built only when needed.
- **Dates and time zones.** A due day is past only after it has ended in the traveller's time zone (UTC only when unknown). Time zones are always saved in their latest official name (`currentTimeZoneName`, `CURRENT_TIME_ZONE_NAMES`).
- **Reviews.** Every change gets an independent review before merge; permissions, sharing, documents, deletion or anything hard to reverse get the strictest review plus a security review. Fix what reviews confirm; prove each new guard fails by breaking the real code once.

## 4. How work runs

1. Preflight: `git fetch origin`, check main's head, open PRs and main's CI.
2. One git worktree per branch (under the session scratchpad), `pnpm install --frozen-lockfile` in it.
3. Plan large or risky work first (a Plan helper), confirm the approach with the owner in at most 3 bullets, flag anything hard to reverse, then build.
4. Targeted tests while building (`nice -n 15`); review; fix; then ONE full check: `PORT=3101 bash scripts/agent/full-check.sh <worktree> <logdir>` (resume a failed run with `FROM=<step>`, for example `FROM=build`). Start it with the tool's background mode, never with a trailing `&` inside a foreground command (the job then loses its completion notice). Read only `<logdir>/summary.txt`. The script is guarded: it finds whatever listens on the port through `/proc/net/tcp` and stops only an earlier Next server (anything else aborts the run), runs the browser steps only against a server that serves the build id it just made, and marks the run STALE when the commit or working tree changed during the run. A STALE or FAILED line means the run cannot be trusted.
5. Push, open a draft PR with the template headings (Summary; PRD / Spec traceability; Type of change; Checklist; Notes for reviewers), unsubscribe from its activity, wait with `bash scripts/agent/wait-ci.sh <full sha>`.
6. All three required checks green on the exact head and mergeable: mark ready, squash merge with the expected head SHA.
7. After merge: `bash scripts/agent/wait-deploy.sh <full merge sha>`; readiness through the Vercel connector (`web_fetch_vercel_url` on `/api/health/ready`; direct `curl` to production is blocked by the session proxy).
8. Report in the owner's format: table (Area | What changed | What you will see | Who notices), then Checked live / Not live yet / Not yet checked / Needs you, ending with what was done and one next step.

**Migrations.** Generate with drizzle-kit (never hand-write snapshots). Production runs them only through `db-migrate.yml` (input `migrate`) from main, so code must work while a new table is missing. Run a migration only with the owner's word for that specific run, right after its merge, then verify on Neon (project `long-sun-23747504`, branch `br-small-river-a408axso`, database `visastackdev`, table `drizzle.__drizzle_migrations`).

**Merging main into a branch.** Append-only files: `python3 -I scripts/agent/merge-append.py <file>` (commit your own edits first). `globals.css`: `python3 -I scripts/agent/merge-css.py`. Lockfile: regenerate with pnpm, never by hand.

## 5. Token discipline (owner rule, 26 October 2026)

The rule itself is in `CLAUDE.md` (sections 5 and 7). Two practical notes: write a long helper brief to a scratchpad file and pass its path; a resumed helper reloads its whole history, so close a helper after its round instead of resuming it again and again.

## 6. Owner decisions in force (newest first)

- 29 Oct: every new build follows and extends the latest interface style (ADR 0023 Calm Core With Depths, `docs/uiux/CONTRAST-AND-SURFACES.md`, `docs/uiux/ccd/VOCABULARY.md`, the parity guard) and never damages existing UX.
- 29 Oct: documentation is kept so any agent can take over with an accurate, non-redundant picture: one fact in one place (the owner doc in section 2), pointers elsewhere, and every PR updates the status pages it affects.
- 28 Oct: the AI connector is switched on in production by the owner (`AI_CONNECTOR_ENABLED=true`); still a controlled pilot with made-up data only.
- 28 Oct: Calm Core With Depths approved (ADR 0023, decisions D1 to D5).
- 28 Oct: pause rule: when the owner says "pause", finish the package in hand and start nothing new until the owner says "go".
- 26 Oct: helpers at most 2 to 3, no overlapping work. Auto-merge and deploy each WP-V4 PR when it is correctly ready (independent review approved, full check green, CI green on the exact head); the final release candidate (WP-V6) still needs the owner's explicit word.
- 26 Oct: visible **reference codes**: type letter plus 6 characters (5 random + 1 check, Crockford-style alphabet without I, L, O, U), e.g. `C-7K2Q9M` for a case, `D-` document, `R-` agency request, `P-` person; stored once in one registry table, unique, never reused; internal ids and calendar UIDs unchanged; migration 0091 pre-approved to run right after its merge.
- 26 Oct: time zones always in their latest official name.
- 26 Oct: calendar must be future-ready: one provider-neutral calendar core, permanent opaque UIDs, SEQUENCE, versioned options, reminders, a typed sync port; no Google or Microsoft connection in v1.2.
- 26 Oct: Prepare Again asks, for each recipient with "all cases" access, whether they may see the new case; no answer means no. Exceptions follow the recipient (a new all-cases share carries the "no" forward); sharing that one case directly is a yes. Migration 0090 pre-approved.
- 26 Oct: the traveller's time zone decides when an agency request is past due, everywhere.
- 26 Oct: Needs Attention ranking (ADR 0016) and Home order (Needs Attention, My Records, Active Requests and Work, My Next Journey, Permissions You Control).
- 25 Oct: AI providers: free tiers allowed and never blocked until the owner says so; data terms recorded per provider; the training guard is built and off.
- 25 Oct: "Download Safe Copies" is the visible name of the DOWNLOAD_REDACTED permission (visa photo sizes now, redacted documents later).
- 25 Oct: profile photos (one per person), visa photo sizes (sized copies per country rule, no face editing, never claim acceptance).
- 26 Oct (Small Commercial V1): target 100 to 1,000 users; preserve what works; **payments start** with one hosted Bangladesh gateway (SSLCOMMERZ) behind `PaymentPort`, invoice by invoice, plus verified manual payments (ADR 0020; this replaces "Stripe first"); **AI Context Gateway**: read-only remote MCP so people connect ChatGPT or Claude to chosen parts of their own record (ADR 0021); document reading becomes automatic, cheapest reader first (ADR 0019). Plan: `docs/roadmap/SONNET-SMALL-COMMERCIAL-V1-HANDOFF.md`; deferred controls: `docs/roadmap/DEFERRED-COMMERCIAL-HARDENING.md`.
- 26 Oct (same day, scope widened): payments (recurring invoices, refunds, second provider), the AI connector (original files, suggestion tools, agency connectors) and product features (real redaction, all WP-V5 outputs) are **built now**; only security and compliance items are deferred (register part 2). Bangla stays last, on the owner's word.

## 7. Open work, in order

Two workstreams run side by side:

- **Small Commercial V1** (status: `docs/roadmap/SONNET-SMALL-COMMERCIAL-V1-HANDOFF.md` section M). In progress: **S23 real redaction** (ADR 0022), not merged and not live; it adds migration 0102, which runs only on the owner's word after its merge. Then, in order: S17 recurring invoices, reminders, overdue and reactivation; S18 refunds, credits and accounting export; S20 AI connector original files (needs S23's safe copies); S21 AI suggestion tools; S22 agency AI connectors; S24 commercial acceptance (prepared only, never merged without the owner's explicit word). S19 only if the owner names a second payment provider. S25 Bangla last, only on the owner's word.
- **Update, 29 Oct 2026 afternoon (Small Commercial V1; supersedes the line above where they differ):** **S23 real redaction is live** (ADR 0022; #339, migration 0102 applied 29 Oct; fixes #340 and #341): safe copies prepare and download in production, previews work again, and the sign-up confirmation page remembers the address. In progress: **S17 recurring invoices, reminders, overdue handling and reactivation** (ADR 0020 Phase 2), not merged and not live; it adds migration 0103, which runs only on the owner's word after its merge (runbook `docs/operations/billing-cycle.md`), and automatic Grace and Suspended stays off until the owner sets O13. Then, in order: S18 refunds, credits and accounting export; S20 AI connector original files (needs S23's safe copies); S21 AI suggestion tools; S22 agency AI connectors; S24 commercial acceptance (prepared only, never merged without the owner's explicit word). S19 only if the owner names a second payment provider. S25 Bangla last, only on the owner's word.
- **Programme X and Calm Core With Depths** (another session): `docs/upgrades/programme/STATUS.md`.
- Alongside, never ahead: engineering roadmap steps 4 and 5 (register H20 and H21 in `docs/roadmap/DEFERRED-COMMERCIAL-HARDENING.md`).

Owner actions that switch built features on: `docs/roadmap/OWNER-ACTIONS-SMALL-COMMERCIAL-V1.md`. Open branches and how to resume: the newest `docs/upgrades/programme/SESSION-HANDOFF-*.md`. Earlier views of this section are in git history.

## 8. Pitfalls learned

- Never read `schema.X` constants at module load in `packages/services` (tests that mock the database crash): copy the literal and pin it with a test.
- `apps/web/src/lib/labels.ts` is imported by browser code: never import server-only modules into it (a guard test checks).
- Next.js route files may export only route handlers and route settings.
- The supply-chain scan reads a regular-expression `.exec(` as shell execution: use `.match`.
- Node 22 reports some time zones by old names (Asia/Kolkata as Asia/Calcutta): never save the runtime's name directly.
- A `to_regclass` presence check is safer than a failing savepoint when parallel queries share a transaction.
- Drizzle's bare `select()` lists every column, so adding a column breaks reads until its migration runs; prefer a new table for additive data that ships ahead of its migration.
- Production migrations run statement by statement (neon-http migrator): hand-written migration SQL must be re-runnable from the top.
- Regular expressions on typed text: no overlapping quantifiers (CodeQL flags them as slow on hostile input).
- Random codes can spell ordinary words: a lookup needs a clear signal (type letter plus separator, or a typed digit) and the normal search still runs.
- Killing background jobs: by process id only, never `pkill -f` with a pattern that matches your own command.
- A session can hit a usage limit mid-task: commit work in progress and push the branch (no PR) so nothing is lost.
- Merging main into a branch: append-only files take main's version plus the branch's own tail. When a force-push to the designated branch is refused, record its old history with `git merge -s ours` instead of rewriting it.
- After moving routes between route groups, `rm -rf apps/web/.next` before typecheck (stale generated route types fail it).
- GitHub can re-subscribe a session to a PR's activity after the PR is created: unsubscribe again when that notice arrives.
- A page that loads data after a link to one of its sections (`#name`) must scroll to that section again once the data arrives (the status page fix in #317).
- Run the local full check only through the guarded `scripts/agent/full-check.sh`, start it with the tool's background mode (a trailing `&` inside a foreground command loses the completion notice) and trust only its summary lines (section 4).
