# G3 plan: agency email truth, branded collection email, request permission, guest correction email

Branch umpe/g3-agency from main 44d3821. Ledger rows A07, A18, A19 (and the P9 gap on A16).

## A18 May Request Documents
- New table `agency_member_capabilities` (organization, membership, capability `REQUEST_DOCUMENTS`, granted by, granted at), one row per membership and capability; deleting the row withdraws it. Reads tolerate the table being missing (no one has the capability).
- `AgencyCollectionScope` gains `authority`: `ADMIN` (owner or admin) or `REQUESTER` (active MEMBER with the capability). `agencyCollectionPrincipal` mints either.
- `agencyCollectionScopeProblem` stays the default and refuses a REQUESTER scope (deny by default: responses, guest files, reviews, rule impact, corrections stay admin-only and look missing). A new `agencyCollectionRequesterScopeProblem` accepts both and is used only by create, list, read, pack choice, draft edit, issue, link, email and end in the request service.
- A REQUESTER sees and changes only requests they created (`created_by_account_id` in every WHERE).
- Link issuer check (public link, guest desk, ISSUER_GONE) becomes `collectionIssuerMayIssue`: owner or admin, or an active member who still holds the capability.
- `setMemberMayRequestDocuments` in organizations.ts: owner or admin only, target must be an active MEMBER of the same agency, audited with ids only; `listOrgMemberships` returns the flag.
- Team page: a Turn On / Turn Off control per member row, registered in a11y-forms.

## A07 Truthful email state per link
- `getCollectionRequest` reads the newest request email notification per link (organization and link ids in the WHERE) and maps it: Queued; Sent to Mail Provider; Delivered only when status DELIVERED and a delivered time from the provider exist; Not Delivered (bounced); Not Sent with a plain reason (link closed, no address, provider refused, stopped). Copied links show Not Emailed.

## A19 Branded collection email
- `renderEmail` takes an optional agency brand: agency name in the header, the accent on the eyebrow and button only when `isAccessibleAccentColor` passes, and a small "Powered by VisaStack" line. Brand read live at send time, ACTIVE agencies only, for the request, code and correction emails. Subjects name the agency only, never the person or route.

## P9 gap: guest correction email
- New event `AGENCY_COLLECTION_GUEST_CORRECTION`, queued in the review transaction when a guest answer gets Needs Correction, to the request address only when its hash still matches the guest who submitted. Rate limited per request and guest.
- Send-time recheck (access/): the decision is still the latest for that submission and still Needs Correction, the submission is live, its link is open (not revoked, replaced or expired), the request is SENT, the agency is open and the issuer may still issue, and the address still matches. Otherwise FAILED with "recipient no longer authorized".

## Tests
Delivered never without a signal; brand only ACTIVE and only a valid accent; member without capability cannot create or send (missing); member with it cannot read responses or guest files; correction email not sent after the link closes; plus team toggle and audit.
