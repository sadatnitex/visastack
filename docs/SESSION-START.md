# VisaStack: start here (every session)

Read this once at the start of a session, then only what your task needs. `CLAUDE.md` (loaded automatically) holds the standing rules; this page is the full picture behind them, for any task, inside or outside Programme X. Last updated 26 October 2026. When something here is out of date, fix this page in the same PR.

## 1. What VisaStack is

An invite-led visa-document platform (public beta, free, at your own risk, controlled pilot with made-up records only; real applicant data is switched off). A traveller keeps one personal record (profile, documents, dates) and reuses it for every visa case; AI suggests details that a person approves; agencies see only what they are given; every action is permission-checked, consent-gated and audited. The owner is a non-technical founder who thinks in systems and strategy: tell them what changed, what they will see and who notices, in plain words.

Production: https://vs.obsidianglobal.studio (fallback https://visastack-five.vercel.app). Deploys from `main` only; pull requests get no preview.

## 2. Where things are

| Need | Where |
|---|---|
| Current product state, what is live and what is open | `docs/public-beta/CURRENT-STATE.md` (newest dated section wins) |
| Setup facts, environment, providers | `docs/operations/current-platform.md` |
| Programme X (interface and v1.2 functional upgrade) | `docs/upgrades/programme/STATUS.md`, then `PROGRAMME.md`, `WORK-PACKAGES.md` (your package only), `allowlists/<package>.txt`, `COVERAGE-LEDGER.csv` |
| Latest session handoff (open branches, decisions, pitfalls) | newest `docs/upgrades/programme/SESSION-HANDOFF-*.md` |
| Functional spec v1.2 | `docs/upgrades/upgrade.v1.2.execution.md` (grep the U/E/B/T/R id) |
| Decisions and their reasons | `docs/adr/` (0015 agency Do Next ranking, 0016 Needs Attention and calendar, 0017 per-case sharing exceptions) |
| Permission rules | `docs/architecture/permission-model.md`; code in `packages/policy` and `packages/services/src/access/` |
| Evidence log (append-only, thousands of lines) | `docs/commercial-v1/known-issues.md`: grep, never read whole |
| Requirement status | `docs/commercial-v1/requirements-ledger.md`: grep the row id |
| Visual reference | `docs/design/harbor-v2/` (immutable), `docs/uiux/PDF-TO-FUNCTION-MAPPING.md` |
| Legal drafts for the owner | `docs/legal/` (reviews, not advice; no compliance claims) |
| Runbooks | `docs/operations/runbooks/`, `docs/operations/backup-resurrection-reconciliation.md` |
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
4. Targeted tests while building (`nice -n 15`); review; fix; then ONE full check: `PORT=3101 bash scripts/agent/full-check.sh <worktree> <logdir>` in the background, reading only `<logdir>/summary.txt`.
5. Push, open a draft PR with the template headings (Summary; PRD / Spec traceability; Type of change; Checklist; Notes for reviewers), unsubscribe from its activity, wait with `bash scripts/agent/wait-ci.sh <full sha>`.
6. All three required checks green on the exact head and mergeable: mark ready, squash merge with the expected head SHA.
7. After merge: `bash scripts/agent/wait-deploy.sh <full merge sha>`; readiness through the Vercel connector (`web_fetch_vercel_url` on `/api/health/ready`; direct `curl` to production is blocked by the session proxy).
8. Report in the owner's format: table (Area | What changed | What you will see | Who notices), then Checked live / Not live yet / Not yet checked / Needs you, ending with what was done and one next step.

**Migrations.** Generate with drizzle-kit (never hand-write snapshots). Production runs them only through `db-migrate.yml` (input `migrate`) from main, so code must work while a new table is missing. Run a migration only with the owner's word for that specific run, right after its merge, then verify on Neon (project `long-sun-23747504`, branch `br-small-river-a408axso`, database `visastackdev`, table `drizzle.__drizzle_migrations`).

**Merging main into a branch.** Append-only files: `python3 -I scripts/agent/merge-append.py <file>` (commit your own edits first). `globals.css`: `python3 -I scripts/agent/merge-css.py`. Lockfile: regenerate with pnpm, never by hand.

## 5. Token discipline (owner rule, 26 October 2026)

- At most 2 helpers at a time (3 only when one is a short read-only check), never two on the same files or question.
- Give each helper a complete brief up front (write long ones to a scratchpad file); batch review findings into one round; close a helper after its round instead of resuming it again and again (a resumed helper reloads its whole history).
- Make small fixes yourself. Run the full check once, after fixes. Read files narrowly (grep, line ranges). Never fetch whole web pages, full CI logs or whole large files.
- Start a fresh session at each natural break (one package per session); keep the handoff and STATUS current so nothing depends on chat history.

## 6. Owner decisions in force (newest first)

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
- Parked until the owner says start: **payments** (provider-agnostic port, Stripe first, then a Bangladesh gateway) and **real redaction**. Deferred: **Bangla and all translation**.

## 7. Open work, in order

See `docs/upgrades/programme/STATUS.md` for the live line. At this writing: calendar export and per-case sharing exceptions are being finished (then migration 0090); next are reference codes (migration 0091), Prepare Again, request screens and colour polish (closing WP-V4), then WP-V5 (shareable outputs) and WP-V6 (final acceptance and release, owner's explicit word). Alongside, never ahead: engineering roadmap step 4 (move about 313 older service functions behind the access gate, shadow mode first) and step 5 (signed step-up proof).

## 8. Pitfalls learned

- Never read `schema.X` constants at module load in `packages/services` (tests that mock the database crash): copy the literal and pin it with a test.
- `apps/web/src/lib/labels.ts` is imported by browser code: never import server-only modules into it (a guard test checks).
- Next.js route files may export only route handlers and route settings.
- The supply-chain scan reads a regular-expression `.exec(` as shell execution: use `.match`.
- Node 22 reports some time zones by old names (Asia/Kolkata as Asia/Calcutta): never save the runtime's name directly.
- A `to_regclass` presence check is safer than a failing savepoint when parallel queries share a transaction.
- Drizzle's bare `select()` lists every column, so adding a column breaks reads until its migration runs; prefer a new table for additive data that ships ahead of its migration.
- Killing background jobs: by process id only, never `pkill -f` with a pattern that matches your own command.
- A session can hit a usage limit mid-task: commit work in progress and push the branch (no PR) so nothing is lost.
