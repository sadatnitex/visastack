# Handover inventory (Part 10 section 15)

Written 2026-10-06. Code: `a27cefb8bd40e0f766870309b02a848c1917307d`. For every system: where it lives, who holds it today, and what a new owner needs. "Holder" is what the repository and the live checks show; where it cannot be known from here it says UNCONFIRMED. The directive's test is that no critical system depends on one contractor's personal account. Several rows below still fail that test and are flagged.

| System | Where it lives | Holder today | Handover gap |
| --- | --- | --- | --- |
| Source code | GitHub repository `sadatnitex/visastack` (private) | Personal GitHub account `sadatnitex` | Move to an organisation owned by the VisaStack entity; add a second admin. FLAG |
| Migrations and schema | `packages/db/migrations` (84 SQL files, newest 0083) with the drizzle config; applied only by the protected `db-migrate.yml` workflow after typing the word migrate | Same repository | None beyond ownership above. Rule: additive only; never rewrite an applied file |
| CI | `.github/workflows`: `ci.yml`, `playwright-smoke.yml`, `deploy-smoke.yml`, `supply-chain-weekly.yml`, `workos-staging-e2e.yml`, `db-migrate.yml`, plus `codeql.yml` and `dependency-review.yml` (both skipped on a private repository) | Repository | Weekly audit failures go by email to one person only; no paging route |
| Branch protection | Three required checks: Lint Build Typecheck Test; No-secret Playwright checks; No-secret smoke check (`docs/governance/branch-protection.md`) | Repository settings | Owner to confirm the settings still match the document |
| Tests | Unit and service suites in each package; browser specs in `apps/web/e2e`; supply-chain self-tests; capacity harness in `packages/load` | Repository | Staging-only authenticated specs have never run (need two staging identities) |
| Prompts and AI evaluations | AI adapters and prompt templates in `packages/adapters/src` (OpenAI, Gemini, Anthropic); quality harness and scoring tests in `packages/services` | Repository | No live evaluation has been run; no judged quality set |
| Rules and evidence taxonomy | Pack, requirement and vocabulary code in `packages/services/src` (`packs.ts`, `rule-conditions.ts`, `vocabulary`) and `packages/policy` | Repository | No published pack; no reviewer. Content ownership is empty |
| Infrastructure and environments | Vercel project `prj_RZcDRy1odwehHuDqsiGwvVGC0epe`, team `team_YDtSBrhGH5u4NwrHUCCddXwS`; one production environment, deployed from main; previews per pull request; no isolated staging | Vercel team whose slug carries a personal name. UNCONFIRMED whether this is the intended entity | Create a staging environment; confirm account ownership and a second admin. FLAG |
| Storage | Neon Postgres (database); Vercel Private Blob (files) | Vercel and Neon accounts as above | Documents have no independent backup. FLAG |
| Identity | WorkOS AuthKit; production project | WorkOS account. Staff MFA is off at the provider | Owner to confirm the account and enforce MFA |
| Key service | `KMS_LOCAL_MASTER_KEY_BASE64` held as an environment value | Vercel environment | No rotation tool, no escrow. Loss of this value makes protected data unreadable. FLAG, critical |
| Malware scanner | ClamAV adapter written and live-tested once; not configured in production | Nobody (not hosted) | Choose, host and fund the scanner process |
| Email | Resend port and signed webhook receiver; not configured | Nobody (no account) | Open the account; record the sending domain |
| Monitoring | Structured errors, `/api/health/live` and `/api/health/ready`, operational signals, Vercel log viewer | Vercel | No outside probe, no paging |
| Provider accounts (AI) | None | Nobody | Open business accounts; record terms |
| Domains | `visastack-five.vercel.app`; `visastack.obsidianglobal.studio` | Domain registrar account UNCONFIRMED | Owner to confirm registrar holder |
| Billing | Manual billing records in app; no payment provider | Owner | Price, currency and process undecided |
| Export path | Self-export and agency bulk export in app (`account-export.test.ts`) | App | Exercised in tests only; not with a real session |
| Backup and recovery | `docs/operations/recovery.md`, `incidents/restore.md`, `backup-resurrection-reconciliation.md`; provider point-in-time history for the database | Provider tier | Never rehearsed (A30 BLOCKED) |
| Support process | `docs/operations/runbook.md` and support-access grants (60 minute maximum, reasoned, approved) | Nobody named | No support contact, no admin screen for support grants |
| Incident contacts | Eight runbooks under `docs/operations/incidents` and `tabletop.md` | Incidentman (incident owner, designated 2026-10-06); backup not named | Appoint primary and backup; hold the tabletop |

## Documents a new operator reads first

1. `docs/commercial-v1/final-report.md` (state of the programme).
2. `docs/commercial-v1/release-gate.md` (what each launch approval needs).
3. `docs/operations/runbook.md`, `incidents/README.md`, `recovery.md`, `release-and-rollback.md`.
4. `docs/security/supply-chain.md` and `threat-model.md`.
5. `docs/commercial-v1/known-issues.md` (append-only evidence log; search, do not read whole).

## Test for "no critical system hangs on one person's account"

FAIL. Source code, hosting, database, files, identity and the master key each sit in accounts whose ownership or second administrator is not confirmed, and the master key has no escrow. This is a launch blocker, listed in the final report.
