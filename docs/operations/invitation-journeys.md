# Invitations and account handoff

> Current status: [product and verified release state](../public-beta/CURRENT-STATE.md), recorded 2026-10-12 18:48 Asia/Dhaka. Earlier dated candidate, activation and verification statements below are historical checkpoints, not current operating claims. Original policy and acceptance requirements remain in force.

The current team and client invitation change is a release candidate until its exact commit is merged and checked on production. These journeys supplement the existing role, consent, expiry and agency-standing rules. They do not enable real applicant data or commercial operation.

## Agency team

An authorised owner or admin enters an email and role. An unregistered recipient receives an invitation link without needing an account. Creation and the encrypted email outbox entry commit together. Only the invitation hash is stored on the invitation; the recoverable email link is encrypted under the existing envelope-key provider. The inviter receives a private copyable link and a native share option. Clipboard refusal falls back to selecting the field for manual copying.

The recipient opens a public explanation, creates an account or signs in, confirms their email if necessary and returns to the same invitation. They review the agency and role, then explicitly accept. Their verified account email must match the invited email. A forwarded team link cannot grant membership to another email. Existing accounts retain the existing immediate-add policy and now receive email and in-app membership notices; this release does not change that membership policy into consent-based joining.

Issuing a replacement team invitation for the same agency and email revokes the earlier pending link. Invites expire after seven days. Revocation, expiry and supersession are rechecked by the email worker; invalid notices are not dispatched. Acceptance remains single-use and GET requests never accept invitations.

## Agency clients

An authorised owner or admin chooses an active case owner, traveller name and contact destination. Email contacts receive the invitation without any account lookup. Phone contacts receive a copyable link for the inviter to share privately; this release does not introduce an SMS provider.

The traveller signs in or creates and confirms an account, reviews the agency's requested permissions, provides the required processing and sharing consents, and chooses their own existing profile or creates one. Only their explicit acceptance connects the profile, sharing grant and case. The agency cannot select or claim an existing wallet by email. Client links retain the existing authenticated token-holder acceptance policy; unlike team links, they are not email-bound. Share them only with the intended traveller. Changing this policy would require a separate approved product decision.

Revoking or expiring an invitation prevents acceptance and suppresses its queued email. A new client invitation does not automatically revoke another client invitation. Use the existing revoke control if replacing a client link. No original download, export or onward-sharing permission is silently added.

## Delivery and recovery

Neon Auth confirmation and password emails are separate from application invitation delivery. Application delivery uses EMAIL_PROVIDER=resend, RESEND_API_KEY and the approved RESEND_FROM_ADDRESS. Signed delivery callbacks use RESEND_WEBHOOK_SECRET. Provider acceptance means the sending service accepted the email, not that it reached the inbox. Only verified delivery callbacks establish the delivery state; inbox placement still requires recipient confirmation.

The existing durable worker is triggered after successful actions, with its scheduled fallback and bounded retry policy. No recipient, invitation token, email body or provider response body is written to ordinary logs. Retry failures remain visible through the existing administration notification controls.

If envelope encryption is unavailable, creation still returns a private link and clearly says email is unavailable. Email contacts with configured encryption get a queued message even if the provider is temporarily unavailable, allowing the worker to retry. Invitations are not marked delivered by the creation form. After a password reset, reopen the original invitation link. An expired or revoked link requires a fresh invitation from the sender.

## Scope and verification

Existing personal profile sharing still addresses an existing account and requires explicit acceptance. It is not an account-registration invitation. Extending that feature to unregistered recipients needs a separately designed pending sharing invitation that preserves exact scope, expiry and recipient binding; it must not create placeholder accounts or grant access merely by matching an email.

Service verification covers email before account creation, encrypted outbox storage, intended-recipient and replay refusal, queued revocation/expiry/supersession, client phone fallback, ciphertext substitution and existing-member notifications. Account-action and component tests cover confirmation return paths, existing-account guidance, external redirect refusal, clipboard denial and native sharing. These checks do not substitute for actual isolated Neon identities, real delivery callbacks or the CF-09 authenticated desktop/mobile journey acceptance, which remain outstanding.


Production configuration checkpoint, 2026-10-12: the pending application email queue was empty at review. The existing Resend key has management access, and vs.obsidianglobal.studio is verified. EMAIL_PROVIDER=resend and the approved branded sender have been saved for Production. An enabled Resend webhook for delivery, bounce, complaint and failure events was registered on the existing application endpoint; its signing secret was saved as an encrypted Production variable. These settings activate with the next deployment. No real invitation email or inbox-receipt test was sent as part of configuration.


## Personal sharing candidate: 2026-10-12

See [the current CF acceptance checkpoint](../uiux/CF-04-09-ACCEPTANCE-2026-10-12.md) for implementation, actual evidence, the first failed diagnostic run and remaining limits. Personal sharing is implemented behind a default-disabled flag and requires reviewed migration 0085 before production activation. The private scanner worker has a free, bounded OCR reader in this candidate. Required checks and actual authenticated acceptance remain separate; sensitive intake is not enabled.

## Deployed personal invitations and remaining acceptance, 2026-10-12

PR 200 deployed personal invitations before registration after the specifically approved migration 0085 and verified Production activation. The owner creates a pending exact-email invitation with fixed scope and expiry. The intended recipient signs in or registers and explicitly accepts under the existing consent and authorization rules. No account is created by invitation issuance; no access is granted by visiting a link or matching email alone. The inviter can copy/share the link and revoke a pending invitation. This supersedes the earlier existing-account-only scope and candidate statements above.

Team links remain email-bound, and existing team accounts retain immediate-add membership behavior. Agency client links remain authenticated token-holder links with explicit profile/consent choice. Do not describe all three policies as identical. Deployed creation, copy and account handoff are not physical inbox or complete recipient lifecycle proof. Those acceptance gaps remain open.

## Client invitations are email only, 2026-10-25

Client invitations now need a valid email address and are bound to it, like team invitations: only an account signed in with that address can open or accept the invitation, and anyone else gets a neutral refusal. Phone contacts are refused at creation, so the earlier "copyable link for phone contacts" path no longer exists for clients. An invitation saved with a phone number before this change cannot be accepted; the agency's client list marks it "Cannot be accepted" and the person who opens it is asked to request a new one by email. Personal sharing invitations are unchanged.
