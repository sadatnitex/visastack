# Supply-chain controls

Owner: security. Last reviewed: 2026-10-06 (commercial v1, Part 9 section 15 and Part 10 section 6).

This page says which checks really run on this private repository, what each one can and cannot
find, and how a result is reported. A check that did not run is reported as skipped. It is never
counted as a pass.

## Why this page exists

GitHub CodeQL and dependency review only run when a repository is public (or has paid code
scanning). This repository is private, so both are always skipped. They are NOT evidence of
anything. The checks below are free, run on every pull request and every week, and need no
third-party service.

## What runs, and when

| Check | Where it runs | Blocks a merge | What it looks for |
| --- | --- | --- | --- |
| Production dependency audit | Every pull request, every push to main, weekly | Yes (high or critical) | Known vulnerabilities in what we ship |
| Development dependency audit | Same | No (shown only) | Known vulnerabilities in build tools |
| Secret scan | Same | Yes | 14 credential shapes in every tracked file and in the added lines of every commit on every branch |
| Licence scan | Same | Yes | Production packages under copyleft or source-available licences (GPL, AGPL, LGPL, SSPL, BUSL and similar) |
| Static analysis (rule-based) | Same | Yes | 10 risky code patterns in shipped code: eval, dynamic functions, raw HTML injection, disabled TLS checks, weak hashes, shell execution, guessable random secrets, wildcard CORS |
| Browser bundle check | Same, after the production build | Yes | Server variable names, credential shapes, server-only code markers and source maps inside files sent to browsers |
| Prompt check | Same | Yes | Secrets, environment values and real-looking email addresses inside AI prompt templates |
| Test fixture check | Same | Yes | Live keys, production database hosts and production blob hosts in tests, seeds and fixtures |
| Preview credential check | Same | Yes | Workflows that run untrusted pull request code with secrets, secrets read by an unreviewed workflow, committed environment files, secret keys given a value in the example file |
| Live virus scanner test | Every pull request | Yes | The scanner really catches the standard test file |

The code is in `scripts/supply-chain/` (`checks.mjs`, `scan.mjs`) and its own tests in
`checks.test.mjs`. Each check has a test that plants a bad input and watches the check fail.
Run everything locally with `pnpm run scan:supply-chain` (build first for the bundle check) and the
self-tests with `pnpm run test:supply-chain`.

## How a result is reported

Every run prints and writes to the job summary: executed, passed, failed, skipped, then one row per
check. A JSON copy is kept as the `supply-chain-report` artifact (30 days for pull requests, 90 days
for the weekly run). In the pull request and weekly runs the scan is started with `--no-skips`, so a
check that could not run turns the job red instead of quietly passing. Read the job-level result of
each step, not only the green tick on the workflow.

## Weekly audit

`.github/workflows/supply-chain-weekly.yml` runs every Monday at 03:17 UTC and on demand
(Actions, Supply chain weekly audit, Run workflow). Scheduled runs only ever use the default
branch, so they always audit trusted code. The workflow reads no repository secrets and has read-only
access. It catches the case that bit us in October: a new advisory published against code nobody
changed. A failed scheduled run is emailed by GitHub to the person who last edited the schedule; no
other alert route exists yet (see "Not covered").

## Where credentials must never appear

| Place | How it is kept clean | Check |
| --- | --- | --- |
| Pull request preview | Workflows that read secrets are on a short reviewed list (migration and staging sign-in tests); neither runs on pull request events; `pull_request_target` is banned | Preview credential check |
| Test fixtures and seeds | Fixtures use made-up values; live-key and production-host shapes are rejected | Test fixture check |
| Browser bundle | Server variable names and credential shapes are searched for in every file sent to browsers; source maps are rejected | Browser bundle check |
| AI prompts | Prompt templates are searched for secrets, environment reads and real email addresses | Prompt check |
| Git history | Added lines of every commit on every branch are scanned | Secret scan |

A line that is a reviewed, harmless match can carry the marker `supply-chain-allow` followed by the
reason. Every use should be questioned in review; there are none today.

## Not covered (be honest about these)

- This is NOT CodeQL. The static analysis is a fixed list of risky patterns; it does not trace data
  through code. A person or an independent review (Part 10 section 7) is still needed for logic
  flaws. CodeQL or an equivalent on a paid plan or a public repository remains an owner decision.
- The secret scan finds known credential shapes. A password that looks like ordinary text is not
  found. It does not check which secrets are still valid.
- Which Vercel variables a pull request preview can see is a setting in the Vercel dashboard. The
  assistant's Vercel access was refused when listing variables, so this is NOT verified. The owner
  checks that production values are not enabled for Preview.
- The weekly audit has no paging. Until an incident owner exists, a red weekly run is seen only by
  email and on the Actions page.
- Actions are pinned by version tag, not by commit. A moved tag would be picked up.
- The licence scan reads package metadata; a package with a wrong or missing licence field is
  listed as unknown but does not fail the run.

## If a check goes red

1. Open the job summary and read the findings list; it names file and line.
2. Secret found: treat it as leaked. Follow `docs/operations/incidents/data-exposure.md` and rotate
   the credential first, then remove it. Removing it from the file does not remove it from history.
3. Advisory found: raise a bounded override in the root `package.json` (an upper bound is
   mandatory) and prove the audit passes again.
4. Never silence a check by editing the rule list without a reviewer reading the change.
