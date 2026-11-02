# Lane C: agency checklist issuance and account invite/reuse (P6/P7)

Independent branch and worktree. Read L4 §1-5, §8-11, L3 necessity taxonomy, relevant audit IDs `A01-A10`, `A17-A19`. Verify current `client-invitations.ts`, branded invitation, logo/accent, email outbox and review/triage. You **must not** rewrite current client invitations or broaden sharing by default.

## P6 agency checklist builder

- Agency operator selects destination, specific route where established, purpose, tentative travel dates, and any eligibility context known, with `not sure yet` where necessary. Generate a proposed source-labelled checklist from applicable published pack; unknown route remains a labelled manual/agency template.
- Operator can add/remove optional or agency-specific items, explain extra requests, adjust due date, choose preferred ordering, and review. Official mandatory items are not secretly edited as official law. Explicitly mark mandatory, conditional, accepted alternative, recommended, extra agency requests and needs verification.
- Agency can create request before having a traveller account/profile/mission. A new organization-scoped, versioned collection request is allowed; it is **not** a lead, CRM opportunity, fake account or mission. Issuing freezes exact pack version, agency overlay, visibility and request revision. Reissue/revoke/expiry preserve audit. Authorize only approved organization roles via canonical policy.

## P7 invitation and registered user

- Issue neutral/safe email through existing Resend/outbox and privately copy/share prepared WhatsApp link through existing share sheet. **Copyable message does not mean VisaStack sent a WhatsApp message**. Track queued/accepted/delivered only when corresponding provider evidence exists; inbox placement remains unproven without test.
- Existing user opens agency-branded neutral preview, signs in with invited verified email where bound, chooses own canonical person/profile, sees exact requested checklist with already-available evidence proposed, reviews/approves selected versions, grants only explicit case/request access and submits. No silent whole-vault share. New account returns directly to original request; no mandatory full-profile wizard.
- Do not leak which addresses already have accounts, case route or PII on unauthenticated preview. Preserve invitation expiry, consent and other agency member access limits. The new request link cannot override older client invite contracts; maintain backwards compatibility.

## Tests

Agency without applicant can issue valid request; authorized staff vs unauthorized staff denied. Non-authoritative overlay distinct. Immutable issued revision; new version doesn't mutate old. Pre-account link works after registration. Existing account sharing scope includes exactly approved versions. Wrong email, forwarded invite, revoked/expired, sender suspended, agency B and cross-tenant negative tests. Copying WhatsApp link shows no accidental 'sent' status. Email failures are truthful and recoverable. Existing client invitation tests all pass.

## Ownership and handoff

New collection request services and owner-scoped UI. Shared schema through schema captain; `client-invitations.ts`/`agency.ts`/`sharing.ts` on explicit lease only. Provide exact issued-request, recipient-proof and version APIs to guest lane; do not implement a second guest session in this branch. Keep P6 and P7 PRs independently reviewable.
