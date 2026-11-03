# P11 plan: checklist corrections and published-rule change impact (branch umpe/p11-corrections, base d6cecf3f)

## What already exists and is reused
- packs.ts: publishPackVersion (marks older published versions DEPRECATED), diffPackVersions (natural-key diff), listPacks. Nothing here edits a pack.
- P4 (umpe-package-service.ts): the case's one "something changed" item. Its freshness check already turns a superseded checklist into a PACK_CHANGED item when the case is opened (getCasePackage) or swept. P11 never writes P4 rows; it sends people to the case page where P4 records that item.
- P10 Official Sources page: the corrections queue sits next to it under /app/admin/packs/corrections, same staff scope (PACK_MANAGE) and the same decision vocabulary (In Review, Dismissed, Accept for Draft).
- notifications.ts worker with send-time recheck (P4 pattern); rate-limit.ts buckets.

## Built here
1. Suggest a Checklist Correction (S06). New table `umpe_checklist_corrections`: pack, version, requirement (nullable for "missing"), category (Missing, Out of Date, Wrong or Does Not Apply, Wrong Necessity Level, Another Document Is Accepted, Official Source Says Otherwise, Something Else), optional https official link (no credentials, never fetched), optional detail (1,000 characters), submitter kind (traveller or agency), submitter account (only for the limit and duplicates, never shown to editors), status RECEIVED, IN_REVIEW, DISMISSED, ACCEPTED_FOR_DRAFT with reviewer, time and note.
   - Traveller: from any line of their case checklist (owner proof, the item must be on the case's pinned version).
   - Agency: from the request detail (AgencyCollectionScope, the item must be on the request's pinned official checklist).
   - Rate limit CHECKLIST_CORRECTION (10 an hour per account). An open duplicate from the same account is not stored twice.
   - Editors (PACK_MANAGE): queue with the cited link and how many others asked the same; decisions record only; Accept for Draft links to Pack Studio and creates nothing.
   - Audit: ids, category, submitter kind and whether a link or detail was given. Never the text or the link.
2. Rule-change impact (S07). New tables `umpe_rule_impact_runs` (one per published version, no person column) and `umpe_rule_impacts` (one row per affected subject and new version).
   - Publish hook (packs.ts, additive): queues a run in the same transaction. It reads and writes no person data.
   - assessRuleImpact (StaffScope PACK_MANAGE, called by the publish action right after publishing) and sweepRuleImpacts (SystemScope process-notification-sweeps, safety net for the lead to wire): ACTIVE cases (not closed, cancelled, submitted or purged) pinned to an older version of the same pack get one impact row with one precise item (the most important difference: added, then changed, then removed) and one note to the case owner (event CASE_RULE_CHANGED, in-app and email). Older open impacts of the same case are closed as superseded and their queued notes cancelled.
   - Send-time recheck: impact still open, case still active and still pinned to the older version, new version still published, and no P4 package-change note already queued or sent for the case since the impact.
   - Handoff snapshots, mission snapshots, issued agency revisions and the cases themselves are never written.
   - Agency requests: the request detail shows the newer published checklist and its precise item through the agency's own scope. Issued revisions stay as they are; reissuing is the agency's choice.
3. Interface: one small component on each case checklist line, one card on the agency request detail, the corrections page, one CSS block WP-UMPE-P11, forms registered in a11y-forms.test.tsx.

## Known limit (needs the lead)
The agency request ratchet allows only AgencyCollectionScope or CollectionLinkProof on the request tables, so a staff or scheduled step cannot list affected agency requests or notify agencies. The columns exist (subject kind, request, organization); enabling it needs a ratchet decision.

## Tests
Suggestion never mutates packs (checksum and rows unchanged); editor permission required; rate limit and duplicates; only active cases flagged; handoff and issued agency revision unchanged; send-time recheck; tables missing degrade to no-ops.
