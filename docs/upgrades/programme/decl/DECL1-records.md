# DECL1 records: saying no to an invitation

Unit DECL1, Class A (permissions, sharing access, migration). Branch `claude/decl1-invitation-decline`. Guardian brief 18 Nov 2026. Migration 0138. Made-up data only.

## Outcome

A person who receives a sharing, client (agency), contributor (document request) or agency team invitation can say no on its accept screen, and it then truly ends: the status is DECLINED, the link stops matching any row, and nothing is created (no grant, case exception, profile, case, membership or upload right).

## What changed

| Area | Change |
|---|---|
| Database (0138) | `DECLINED` added to `organization_invitation_status`, `client_invitation_status` and `contributor_request_status` (`ADD VALUE IF NOT EXISTS`); `sharing_invitations_status_check` replaced to allow it (`DROP CONSTRAINT IF EXISTS`, then add). No new column. Re-runnable statement by statement. Generated with drizzle-kit (snapshot `meta/0136_snapshot.json`, journal tag `0138_invitation_declined`). |
| Services | `declineSharingInvitation`, `declineClientInvitation`, `declineOrganizationInvitation`, `declineContributorRequest`. Each: counts the try per account (`RATE_LIMITS.INVITATION_DECLINE_ACCOUNT`, 30 an hour, action `invitation.decline`), checks 0138 is in place (`invitationDeclineAvailable`, catalogue probe, a yes cached per handle), then one conditional update in a transaction (token hash matches, addressed to the caller's own signed-in email, PENDING, unexpired) that sets DECLINED and replaces the token hash with the hash of a fresh random token nobody holds. Audit: `SHARING_INVITATION_DECLINED`, `CLIENT_INVITATION_DECLINED`, `ORGANIZATION_INVITATION_DECLINED`, `CONTRIBUTOR_REQUEST_DECLINED`, ALLOWED with ids only; a refusal is the same event type, DENIED, with only the actor and the kind (no invitation, applicant, address or name). A rate-limited try records nothing. |
| One answer | Every refusal (unknown or malformed link, someone else's, used, withdrawn, expired, already declined, too many tries, 0138 not in place) returns the kind's existing not-found key: `sharing.inviteUnavailable`, `client_invitations.invitation_not_found`, `invitations.invitation_not_found`, `contributor_requests.request_not_found`. No new service message keys. |
| Retention sweeps | `sweepAbandonedClientInvitations` and `sweepAbandonedOrganizationInvitations` also delete DECLINED rows whose `updatedAt` is past the same 30-day cutoff (a declined row has no `revokedAt`). |
| Accept screens | `sharing-invitations/accept`, `client-invitations/accept`, `contributor-requests/accept`, `invitations/accept`: a secondary Decline after the accept action, shown only while the preview is open for this account and 0138 is in place. Decline opens a short confirm in place (the shared Expandable Section, no dialog) and one more press sends a plain form post (works with JavaScript off). Shared component `components/decline-invitation.tsx`, built on the shared Expandable Section, with the existing `lc-g3-confirm` classes for the confirm (no CSS added). |
| After a decline | New page `/app/invitations/declined` ("Invitation Declined"), the same for every kind, reads nothing. Guarded in `apps/web/ci-signed-in/routes.ts` (traveller). |
| Sender side | Sharing invitation rows read Declined (`INVITATION_STATUS.DECLINED` in `lib/status-words.ts`); the case page's contributor request list reads Declined. Access Log words: Sharing Invitation Declined, Document Request Declined. Agency team and client lists show pending invitations only, so there is nothing to label there. No notification fires to a sender on accept, so none is added on decline. |

## Status uses checked (pre-mortem 1)

Schema enums and the sharing check; `lib/status-words.ts` INVITATION_STATUS (was raw DECLINED); `applicant/[id]/sharing/page.tsx` history and pending counts (PENDING only, correct); `mission/[id]/contributor-requests-panel.tsx` STATUS_LABELS (was raw); `agency/[orgId]/console-data.ts` team and client pending lists (PENDING only); `plans.ts` seat count (a decline frees the seat); `notifications.ts` delivery checks (PENDING only, a queued email is not sent); `case-deletion.ts`, `sharing.ts` case questions, `backup-reconciliation.ts` (PENDING only); `export.ts` (raw status string, acceptable); every revoke (conditional on PENDING, so a declined row cannot be revoked). The two Bengali catalogue files owned by PR #581 (`app-applicant.ts`, `app-shared.ts`) have no sender-side status label and were not touched.

## Decisions (Guardian, 18 Nov 2026)

- Deviations in the ACK accepted. Token: keep NOT NULL; overwrite with the hash of a fresh random token made with the issuance helpers; tested that the old token then fails both accept and decline.
- Sweeps include DECLINED with the same cutoff, tested.
- Access ratchet: option 1. Four reasoned `APPLICANT_TRUSTED` entries in `packages/services/src/access/enforcement.test.ts` (the reviewed-reason mechanism of owner decision "G3 A", 1 Nov 2026), each naming `invitation-decline.test.ts`. The refusal recorder is private in each module (only the pure `declineRefusedEvent` builder is shared), so four entries, not five. A test proves a signed-in account with a different address leaves the row PENDING.
- `apps/web/ci-signed-in/routes.ts` added to the manifest for one guarded ROUTES entry. Six new test files inside the unit's folders approved.

## New catalogue keys (English only, for the localization lane)

One contiguous group per catalogue, each marked `// DECL1` ... `// end DECL1`:

- `apps/web/src/i18n/app-sharing-invitations.ts`: `appSharingInvitations.appSharingInvitationsDecl1.{decline,explain,confirm,busy}`
- `apps/web/src/i18n/app-client-invitations.ts`: `appClientInvitations.appClientInvitationsDecl1.{decline,explain,confirm,busy}`
- `apps/web/src/i18n/app-contributor-requests.ts`: `appContributorRequests.appContributorRequestsDecl1.{decline,explain,confirm,busy}`
- `apps/web/src/i18n/app-invitations.ts`: `appInvitations.appInvitationsDecl1.{decline,explain,confirm,busy,declinedTitle,declinedBody,returnToYourWorkspace}`

Not in a catalogue (hard-coded English like their neighbours): the status words Declined (`lib/status-words.ts`, contributor request panel) and the two Access Log labels.

## Production

Migration 0138 runs only on the owner's word "migrate 0138" after the merge. Until then the screens show no Decline and every decline action refuses with the one answer (tested by restoring the old sharing check on a migrated database, and with a stubbed probe).

## Rollback

Revert the PR. The enum values and the widened check stay (harmless, unused). No data loss: a decline only changes the status of PENDING invitations.

## Not verified

Real-device and live signed-in click-through of the four screens; behaviour on production before and after 0138 (needs the owner's word).
