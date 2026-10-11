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

### PR #184 production verification

Exact merge commit: 2c6d7c9ec31f5b10a17df23019d74d1364913407. Required main checks and deployment checks passed. Newly created agencies receive explicit Founding Access; owners can request eligible original downloads with fresh authentication; operators receive improved email delivery state. Readiness and anonymous denial were checked live. Authenticated journeys and actual provider acceptance remain outstanding. PR-00 is recorded; PR-01 through PR-05 remain in progress; PR-06 through PR-08 remain; PR-09 is gated. Real-document intake stays disabled and Neon has nine branches.

## UI transformation shipping checkpoint (2026-10-10)

PR #187 contains the public, authentication, traveller, agency and administration interface update. It is pending verified merge and deployment; its final release outcome will be recorded on the pull request. See docs/uiux/EXECUTION-CHECKPOINT.md.

Public-beta actions: PR-00 is done. PR-01 through PR-06 remain in progress, with privileged authentication, email/legal acceptance, quota acceptance, R2/PDF/key/backup evidence, authenticated lifecycle and job monitoring still outstanding. PR-07 reviewed packs/AI and PR-08 measured cost/control-room remain open. PR-09 release acceptance and activation remain gated. Interface implementation does not close these operational acceptance requirements.

## 2026-10-11: whole-product reference correction

PR #187 is verified merged and deployed on `2f07d915c37d6ff5895bdad27f482cec8903ad12`, with production readiness and both aliases checked. The subsequent owner correction requires the original HTML appearance independently of device preference and applies to all 52 page routes. The next UI-only release is pending exact-head verification; its pull request records the final merge and deployment outcome.

PR-00 is done. PR-01 through PR-06 remain in progress: privileged identity and lifecycle acceptance, email/legal delivery, live quota acceptance, R2/PDF/key/backup evidence, authenticated collaboration and job operations remain outstanding. PR-07 reviewed packs/AI and PR-08 measured cost/control-room remain open. PR-09 release acceptance and activation remain gated. The UI correction does not change provider activation or open real-applicant intake.

## Preview and recovery follow-up checkpoint (2026-10-11)

PR-188 is merged and deployed, with production browser appearance failures still under correction. Current source work adds preview-aware absolute links, matching content-security origins, explicit password-recovery confirmation/resend states and configurable R2 region. Its release checks remain pending at this checkpoint. Native encryption is already enabled; R2 reachability, authenticated owner access, live reset delivery, PDF processing and backup recovery remain unverified or blocked. No public-beta package is promoted to complete by these changes.


## PR 191 and PR 192 verified production outcomes (2026-10-11)

| Area | What changed | What you will see | Who notices |
| --- | --- | --- | --- |
| Signup | Existing-account guidance avoids duplicate registration | Sign-in and reset options for an existing email | Returning users |
| Branding | Neon Auth application name is VisaStack | Newly generated mail should use VisaStack; delivery rendering is untested | New users and recipients |
| Public header | Flat border paint retains approved geometry | Consistent appearance under light/dark device preferences | Public visitors |
| Database recovery | Private isolated encrypted-backup restore | Operators have actual database-only recovery evidence | Founder and operators |

Checked live: exact PR 191 merge 390845818e9546e9776a1abbcb78ad44bc655d71 and PR 192 merge c18bbda2f905105fce269a72b7fc6717d9be837b, required main/deployment checks, aliases, readiness and anonymous protected-route refusal. PR 192 restore run [38128672220](https://github.com/sadatnitex/visastack/actions/runs/38128672220) passed its actual isolated recovery step. No production restore occurred.

Not live yet: PR 193 notification/scheduler hardening and the PR-07/08 source-review/provider-panel continuation. Not yet checked: newly delivered branded email, complete document/key/lifecycle recovery, authenticated acceptance and provider billing headroom. Needs owner/provider evidence: see OWNER-ACTIONS.md and RELEASE-ACCEPTANCE-CHECKPOINT.md.

Done: PR-00 and the narrow deployed changes above. In progress: PR-01 through PR-08, including PR-04 complete recovery and PR-06 real scheduling/delivery acceptance. Remaining: PR-09 complete journeys, staging/integrations/security/performance/legal/recovery/rollback and final classification. Current safe operating scope is controlled pilot with sensitive applicant intake disabled.
