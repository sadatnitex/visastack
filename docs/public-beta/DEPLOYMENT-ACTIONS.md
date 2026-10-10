# Public beta deployment actions

Update this log after each deployment. Each report must state what changed, what users will see, who is affected, live verification, and the done/in-progress/remaining actions below. A deployed repair does not complete its whole package.

## 2026-10-10: legacy authentication routes, PR #182

Production merge: 695a7feade667454f0d4935cbfa27f42950a65a5. All three required pre-merge checks passed. Vercel deployment and Deploy Smoke passed. Live readiness returned ready; /callback redirects to /auth/sign-in and /api/session-reauth redirects to /auth/reauth with a safe return path. Post-merge full CI is still pending at this checkpoint. Real account and email acceptance remains unverified.

| Area | What changed | What users will see | Who is affected |
| --- | --- | --- | --- |
| Old sign-in links | Selected-provider callback routing | Neon sign-in rather than a failed WorkOS exchange | People using old callback links |
| Sensitive-action verification | Selected-provider reauthentication | Neon password confirmation, safe return path | Signed-in users confirming sensitive actions |

| Public beta package | Status | Done | Remaining |
| --- | --- | --- | --- |
| PR-00 baseline | Recorded | Environment, source inventory, migration inspection, local checks | Complete current post-merge verification |
| PR-01 identity | In progress | Session shell, provider-aware logout/denial, callback and reauthentication routing | Safe account continuity, Neon-only selection/dependency cleanup, privileged assurance, actual auth journeys |
| PR-02 Resend/admission | Remaining | Provider choices and sender recorded | Verified delivery/SMTP acceptance, admission/legal acknowledgement, anti-bot and public-registration acceptance |
| PR-03 Founding Access | Remaining | Requirements recorded | Separate admission/policy/safety/entitlement, complimentary plans and fair use |
| PR-04 document safeguards | Remaining | Existing safeguards inventoried | Real scanner, managed keys, authorized download proof, independent backup/restore and provider approvals |
| PR-05 role journeys | Remaining | Existing capabilities inventoried | Complete traveller, family and agency journeys and lifecycle acceptance |
| PR-06 durable operations | Remaining | Existing job architecture inventoried | Trigger, retry/lease, scheduler and backlog proof |
| PR-07 packs/AI | Remaining | Existing manual paths inventoried | Reviewed coverage, provider/privacy/cost proof and safeguards for sensitive input |
| PR-08 founder control room | Remaining | Requirements recorded | Measured usage, cost, capacity and future monetization |
| PR-09 release candidate | Gated | Acceptance requirements recorded | J01-J25 evidence, exact-SHA checks, rollback and owner-approved activation |

Current next change: prevent verified-email-only legacy account transfer and show a recoverable verification state. It is being verified locally and is not live. Controlled recovery must be reviewed before any actual account relinking. No production schema/data changes, emails, secret rotations or activation were performed.

## 2026-10-10: account recovery and coordinated PR-02 through PR-05 checkpoint

PR #183 merged as fff184d53abd35265a56f761e37ac69f29e66a32 after the required current-head checks passed. It prevents a new identity from claiming an existing account through email matching alone and presents a recoverable verification page. This protects existing account holders; new verified identities with no conflicting account can still provision normally. Post-merge production verification is pending at this checkpoint. Real authentication and controlled relinking are not certified.

PR-02 through PR-05 are now one coordinated engineering batch. Implemented code, remaining acceptance, provider prerequisites and per-audience impact are recorded in PR02-05-COORDINATED.md. All four remain in progress. PR-00/01 retain their previously recorded limitations; PR-06 through PR-09 remain outstanding. No public beta activation follows from either change.

### PR #183 verification completed

All required merge-commit CI and deployment checks passed for fff184d53abd35265a56f761e37ac69f29e66a32. Live readiness, account-recovery guidance and anonymous workspace denial passed; the denial is a valid relative same-origin sign-in redirect. Neon inventory is nine. This protects existing account holders from email-only transfer. Real account recovery, privileged assurance and authenticated journeys remain unverified. PR-02 through PR-05 are still in progress in coordinated PR #184; the other package statuses above remain applicable.
