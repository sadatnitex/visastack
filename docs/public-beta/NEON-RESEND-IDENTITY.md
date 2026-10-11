# Neon and Resend migration baseline

Neon Auth is the final selected identity provider. Resend SMTP in Neon delivers auth verification/reset messages; the existing Resend adapter delivers VisaStack application messages. These are separate configurations using one provider, not a second token system.

Read-only cloud proof at frozen main: all 85 expected migrations applied; 0084_plain_speed_demon hash exists in the journal and accounts.neon_user_id exists. No migrations were executed. Production identity/data scope is unknown.

Confirmed corrections in this patch:
- Root navigation reads the selected identity port rather than WorkOS withAuth.
- Workspace sign-out dispatches through signOutCurrentUser.
- Access-denied identity uses the selected port without opening a DB session or provisioning.
- Read failures keep public/denial wording safe and use the existing sanitized server-error reporter.

The six new tests failed on the old implementation. Focused auth/session checks passed 14/14 after the changes. These are local synthetic checks, not real logout/session revocation evidence.

Remaining PR-01 work: Neon-only default/fail-closed selection; old callback and session-reauth paths; CSP and obsolete browser/smoke workflows; safe account continuity; verified privileged assurance; SDK compatibility and renewal; removal of active WorkOS dependencies after callers are migrated.

Security risk: current provisionNeonAccount automatically binds a pre-existing matching verified email. The new mandate explicitly requires stronger original-identity or controlled recovery assurance. Preserve canonical IDs, historical workos_user_id and audit snapshots. Do not enable or claim safe legacy migration merely because the email is verified.

The owner reports current live signup/sign-in work. Do not reset their provider settings or open registration in production to test this patch. Real email, password/reset/renewal/MFA acceptance needs an authorized isolated fixture and consenting inboxes.

Historical runbooks remain evidence: [migration plan](../commercial-v1/neon-auth-migration-plan.md), [public beta sign-in](../operations/public-beta-sign-in.md). Their WorkOS-default and email-only-linking recommendations are superseded as target behavior by the current owner directive.


Remaining caller map at this patch:

| Source | Continuation responsibility |
| --- | --- |
| apps/web/src/lib/identity-selection.ts; providers.ts | WorkOS default and provider validation must become the reviewed Neon-only contract |
| apps/web/src/middleware.ts | Preserve protected-route checks, session renewal and CSP while removing the old provider |
| apps/web/src/lib/session.ts; identity-provider.ts | Preserve verified identity, account continuity, pilot admission and domain policy |
| apps/web/src/lib/session-age.ts; step-up.ts | Prove absolute/idle limits and privileged assurance without reusing WorkOS checks |
| apps/web/src/lib/sign-out.ts | Remove the old provider and prove SDK error handling, cookie clearing and actual revocation |
| apps/web/src/app/callback/route.ts; api/session-reauth/route.ts | Reconcile callback/recovery behavior and fresh authentication with Neon |
| packages/services/src/accounts-neon.ts | Replace email-only legacy binding with approved original-identity or controlled recovery proof |
| apps/web/scripts/smoke.mjs; e2e/no-secret-auth.spec.ts; CI workflows | Replace obsolete WorkOS-only redirect assumptions and run exact-head checks |

Contract review: navigation and denial are read-only hints; withSession and middleware remain the permission/admission boundaries. Adversarial review: selected-provider read failures render safe signed-out/generic output and use sanitized logging, with no fallback to a different identity provider. Actual provider renewal/revocation and stronger legacy linking remain unverified.


2026-10-10 routing continuation: /callback and /api/session-reauth now choose the selected provider before importing or invoking WorkOS. Neon stale callbacks go to same-site sign-in; fresh-auth requests use Neon password re-check with safe return paths. Legacy routes are retained for explicitly selected WorkOS deployments. This supersedes the earlier routing gap only; Neon-only defaults, dependency removal, safe linking, MFA and actual renewal/revocation remain incomplete. See EXECUTION-CHECKPOINT.md for local evidence.


Account continuity continuation (2026-10-10): verified-email-only legacy transfer is removed. Immutable existing Neon bindings still work; unresolved legacy or conflicting bindings require controlled recovery with generic wording, unchanged account records and denied audit evidence. The recovery page grants no records or linking capability. Safe original-identity proof and actual recovery/holder-notification acceptance remain required. This supersedes the earlier email-only-linking behavior, not the full PR-01 completion criteria.


## Current operating correction (2026-10-11)

Neon Auth is configured for production; legacy WorkOS references do not authorize email-only record linking or claim current staff MFA acceptance.

Earlier implementation snapshots and provider-specific instructions above are retained as history. For current setup, incident response and availability, use [current operating guidance](../operations/current-platform.md). Original acceptance and security targets remain in force; this correction does not mark them complete or authorize migration, production restore, paid activation or sensitive-data intake.
