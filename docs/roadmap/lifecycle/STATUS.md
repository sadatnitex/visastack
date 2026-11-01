# Resource Lifecycle Programme: status board

During the run, each lane's own file (`lanes/<LANE>.md`, Status section) was the live record. Lane Z wrote this final state on 1 Nov 2026.

| Lane | Wave | What | State | PR | Merged SHA |
|---|---|---|---|---|---|
| F | 0 | Foundation: migration, lifecycle rule and guard, receipts, removal path, names, screen pieces | Merged | #381 | 9d5bb99a |
| G1 | 0 | Profile: No Longer Current, Ended | Merged | #379 (docs #380) | 823de13a |
| G2 | 0 | Active Cases and Past Cases | Merged | #382 | cfd8e392 |
| G3 | 0 | Withdraw a pending agency application | Merged | #389 | 03a25dc6 |
| A1 | 1 | Archive and Restore documents; readiness correctness | Merged | #395 | 1f2f2e9b |
| A2 | 1 | Every read path uses the lifecycle rule | Merged | #388 | 0c6e35a4 |
| B | 1 | Replace With a Newer Document; renewal from reminders | Merged | #393 | 19ec6a15 |
| C | 1 | Duplicates, Recently Deleted, Removal Records, Tidy Up | Merged | #396 | 9c8b664e |
| D | 1 | Ask Us to Remove This File (support review) | Merged, switched on | #399 | b00a5b19 |
| E | 1 | Travellers: Archive, Restore, Remove Empty Record | Merged | #400 | 457fb5e7 |
| Z | 2 | Integration, acceptance, central documents, owner report | Merged, accepted (G-Z) | #403 | 8f00f610 |

## Owner gates (PROGRAMME section 10)

| Gate | State |
|---|---|
| G-GO | Given (the coordinator prompt from `KICKOFF.md`). |
| G-MIG | Given. Migration 0113 ran on production on the owner's word: `db-migrate.yml` run 41263156493, 1 Nov 2026 01:57Z. Confirmed: 112 rows in the migration journal, the four lifecycle tables, and the `DOCUMENT_REMOVAL` erasure reason. Production is in "tables present" mode. (Paid plans migration 0114, run 41289963351, is a separate track.) |
| G-D | Approved by the owner on 1 Nov 2026 ("G-D approved"). Reviewing role: the Compliance Admin role reads the queue and decides; a decision needs a fresh sign-in; no new role. Then "switch on removal requests": `DOCUMENT_REMOVAL_REQUESTS=on` is set in Vercel production and redeployed (by the coordinator). |
| G-Z | Accepted by the owner on 1 Nov 2026 ("G-Z accepted") after reading lane Z's report. Open: the Founding Access question in `lanes/Z.md` (Blocked). |

### Privacy notice lines approved at G-D (the exact wording on screen today)

- Recently Deleted: "Moved to Recently Deleted. Removed in 30 Days." and "You can restore it from Recently Deleted until then. Each removal is listed in your Removal Records."
- Removal requests: "Our support team checks the request, usually within 3 working days. If they approve it, the file is removed from VisaStack for good and any open case that uses it will ask you to choose another document. Cases you already finished keep their record."
- Backup expiry (D10): "Removed from VisaStack. Backup copies expire within 90 days and are never brought back."

## What is live

Everything in the table is live on production with the lifecycle tables present: Archive and Restore, Replace With a Newer Document (also from the expiry reminder), Delete Duplicate and Remove This New Copy, Recently Deleted with Undo and Restore, Removal Records, Tidy Up, Ask Us to Remove This File and the staff Removal Requests queue, traveller Archive, Restore and Remove Empty Record, No Longer Current and Ended on the profile, Active and Past Cases, and Withdraw Application. Lane Z adds the lifecycle labels on case evidence (the traveller's case page and the agency case view) and the four measures on the admin Product Scorecard.

## Cross-lane acceptance (PROGRAMME section 8)

Each row's journey test is listed in `lanes/Z.md` (Status) and in `docs/commercial-v1/known-issues.md`, 2026-11-01 Resource Lifecycle Programme (lane Z).
