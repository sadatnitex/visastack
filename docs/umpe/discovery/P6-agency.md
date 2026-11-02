# P6-P9 discovery: agency requests, invitations, guest collection (HEAD d17d717c, read-only)

Paths relative to `packages/services/src` unless stated. Condensed by the lead from the researcher's hand-back.

## Invitations today
- Tokens: 32 random bytes base64url; only the SHA-256 hex is stored (`invitation-tokens.ts:13-19`). Shared by team, client, sharing and contributor invitations.
- Client invitation (`client-invitations.ts`): OWNER/ADMIN only (:212), email only (:226-233), rate limited 60/h per actor and 200/h per org (:236-251), 7 day expiry (:56), single use by compare-and-set (:620-640), revoke (:768). Email-bound: `isIntendedRecipient` (:72-86) compares the signed-in email; a wrong account gets a neutral refusal.
- Opening a link grants nothing. The public view (`getPublicClientInvitationView` :469) shows agency name, verified flag, accent, logo and grant actions only; unknown, expired, revoked and used links all return the same closed answer. Page rate limited per IP (`apps/web/src/lib/invitation-preview.ts`), `referrer: no-referrer`. The token travels in the query string (`invitation-email.ts:11-14`).
- Accept (:582-760) creates or chooses the applicant, creates a case, a grant with `DEFAULT_CLIENT_GRANT_ACTIONS` and an assignment, in one transaction. Applicant-shaped throughout, so a request cannot reuse it.
- `invitation-email.ts`: `InvitationLinkKind = team|client|sharing|contributor`; the link is AES-GCM sealed in the notification payload; allowed paths are hard-coded in `revealInvitationLink`.

## Evidence requests today
`agency.ts:1677 requestEvidence` needs OWNER/ADMIN plus an org grant with MANAGE on an existing applicant; `evidenceRequests.applicantId` is NOT NULL (db `schema.ts:2681-2700`); R- reference codes. So A03 and A17 are gaps: a request cannot exist before a person record.

## Brand
`organizations.name`, `accentColor` (hex, AA-checked in `branding.ts:105`), `logoObjectKey`. "Verified" means `organizations.status === 'ACTIVE'` (client-invitations.ts:445-455). Client theme helper `apps/web/src/lib/agency-brand.ts`.

## Guest path
None. Every file route uses `withSession`. No email one-time code exists (`apps/web/src/app/api/auth/route.test.ts:36-37` asserts the direct Neon OTP endpoint returns 404). A guest proof would be new: a code-hash table plus an EMAIL notification through `notifications.ts` and the Resend adapter.

## Access gate
`access/require-access.ts` returns a branded `AuthorizedApplicant`; targets are applicant, case or document ids. The ratchet (`access/enforcement.test.ts:844-932`, `enforcement-baseline.json`, shrink-only) covers every exported function touching a table with `applicant_id`, `mission_id`, `document_id`, `document_version_id` or `owner_account_id`. New request tables must not carry those columns.

## Roles
OWNER, ADMIN, CASE_MANAGER, REVIEWER (`core/domain.ts:108`). `isOrgAdmin` (`organizations.ts:38-56`) is the only gate for invites and evidence requests; no per-capability permission (A18).

## Mail
`enqueueNotification` writes a durable row; EMAIL accepts a recipient without an account; the worker re-authorizes each event type at send time (`notifications.ts:372-440`); statuses QUEUED/SENT/DELIVERED/BOUNCED/FAILED with the Resend webhook. Email templates are VisaStack-branded only (`email-design.ts:198`), so A19 is partial.

## Status A01-A20
See `docs/umpe/ledgers/REQUIREMENT_LEDGER.csv` (Lane C and Lane D rows).

## Minimal design (frozen in ADR 0026 D4 and D5)
Tables `agency_collection_requests`, append-only `agency_collection_request_revisions` (pack_version_id, pack checksum, overlay items with necessity and source, brand snapshot, content hash) and `agency_collection_links` (token hash, expiry, revoke, reissue history). No person-owned columns. Separate `/collect` route. Reuse token helpers, `listFittingPublicPacks`, `listRequirements`, `verifyPackChecksum`, `isOrgAdmin`, `checkRateLimits`, `appendAuditEvent`, sealed invitation email and `enqueueNotification`.

## Reviewer checklist for P6 to P9
Link is never identity; only hashes stored; no plaintext token in the outbox; token moved off the query string into a session cookie on first open; issued revision immutable and re-verified on read; agency overlay visibly separate from official items; org id in every WHERE (no cross-tenant IDOR); suspended agency or removed issuer closes the link; send-time suppression after revoke; no WhatsApp delivery claim; per-IP, per-token and per-org rate limits; the agency never learns whether an account exists; branding only for ACTIVE agencies; turning a request into a case is a separate consent step.
