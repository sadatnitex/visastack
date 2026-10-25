# WP-V4 W0 ledger

Groundwork for WP-V4 (v1.2 PR2/S4: reuse, Needs Attention, resumable requests, agency triage, Do next). Research and documentation only. Read at `main` `2ec8f72` (#254). No application file was changed and nothing was built, tested or run.

Sources read: `WORK-PACKAGES.md` WP-V4 (lines 271-296), `PROGRAMME.md` section 8 (lines 158-179), `A0-AUDIT.md` section 3, `allowlists/WP-V4.txt`, v1.2 spec `docs/upgrades/upgrade.v1.2.execution.md` (E02 lines 65-75, B04 304-317, B05 319-333, B09 414-450, B13 513-519), and the code cited below.

Dependency note: WP-V4 depends on WP-V3. At this SHA only WP-V3 part 1 is merged (#248); parts 2 (four-tab shell) and 3 are still to come (`STATUS.md:8`). Both WP-V3 and WP-V4 change `apps/web/src/app/app/page.tsx`, so WP-V4 should branch after WP-V3 part 3 merges.

## 1. Head-start verification

| # | Claim in WP-V4 | Result | Evidence at `2ec8f72` |
| --- | --- | --- | --- |
| H1 | `agency/[orgId]/page.tsx` is about 628 lines | Confirmed | `wc -l` gives 628 |
| H2 | Page shows pipeline, inbox and a case table with a Deadline column | Confirmed | Case Pipeline `page.tsx:291-317`; "Cases and Attention" section `page.tsx:326`; Deadline column `page.tsx:382`, cell `page.tsx:430-432` |
| H3 | Quick views Mine, Overdue, Waiting On Traveller, Unassigned via a `quick` URL parameter | Changed (wording and meaning) | `page.tsx:184-193`, parameter read at `page.tsx:68`. The label is "Waiting on Traveller" (lower-case "on", pinned by `page.test.tsx:180`). Its test is `openRequests > 0`, and `openRequests` counts only `OPEN` (`page.tsx:161-163`), so a request sent back for replacement (also waiting on the traveller) is not in this view |
| H4 | `summarizeAttention`, `countOverdueTasks`, `nextApproachingDate` live in `console-format.ts` with tests | Confirmed, with one gap | `console-format.ts:88`, `:62`, `:40`; `console-format.test.ts` exists. Gap: `countOverdueTasks` counts only `OPEN` tasks (`console-format.ts:67`), while the reminder sweep treats `OPEN` and `IN_PROGRESS` as live (`notification-sweep.ts:128`). A started task past its due date is not "overdue" on the agency page. No existing test pins `IN_PROGRESS` either way |
| H5 | `console-data.ts` and `page.test.tsx` exist | Confirmed | Both present, plus `console-data.test.ts` |
| H6 | Evidence requests carry `kind`, `docType`, `message`, `dueDate`, `status`, `createdAt` | Confirmed, incomplete | `schema.ts:2482-2522`. Also carried: `missionId` (nullable: a request can be applicant-wide with no case), `packRequirementId`, `fieldKey`, `requestedByAccountId`, `respondingFactId`, `respondingDocumentId`, `respondedAt`, `updatedAt` |
| H7 | `listEvidenceRequestsForOrg` returns them to organisation owners and admins only; non-admin workers see none | Confirmed | Service refuses non-admins (`agency.ts:1581-1594`, `isOrgAdmin`). The console never asks for non-admins: `loadEvidenceRequests` returns `[]` (`console-data.ts:95-104`). Related: the member roster is also empty for non-admins (`console-data.ts:83-92`), so a Do next "owner" name cannot be resolved for them beyond "You" |
| H8 | Needs Attention and ICS seams: `notification-sweep.ts`, `expiry.ts`, `apps/web/src/lib/ics.ts`, a mission appointment ICS route | Confirmed | `sweepTaskDeadlineReminders` `notification-sweep.ts:105`, `sweepExpiryReminders` `:201`; `classifyExpiry` `expiry.ts:51`, `classifyStaleness` `expiry.ts:90`; `buildIcsForAppointment` `ics.ts:60` builds one event only; route `apps/web/src/app/app/mission/[id]/appointments/[appointmentId]/ics/route.ts` exists. There is no reminder sweep for evidence-request due dates, and no multi-event ICS builder |

Earlier ledger facts re-checked:

| # | Fact (source) | Result | Evidence |
| --- | --- | --- | --- |
| L1 | U02: `createMission` has no source-case or reuse input (`COVERAGE-LEDGER.csv` U02) | Confirmed, line moved | `missions.ts:170-189` |
| L2 | U03: Home builds attention from open requests, pending suggestions and pending grants (ledger U03) | Confirmed, with one gap | `app/app/page.tsx:98-135`. Home counts only `OPEN` requests (`page.tsx:85-87`), so "send a replacement" never reaches Home |
| L3 | A0 E02 table: `RECEIVED` belongs to Processing | Wrong | A request reaches `RECEIVED` only after the document passed safety and processing: `submitEvidenceResponse` refuses an unusable document (`agency.ts:1831-1838`, `documentIsUsable` `agency.ts:55-74`, rule `documents.ts:893-903`). Processing can only come from the document, never from the request status |
| L4 | A0 E02 table: `FULFILLED` belongs to Reviewed | Wrong | `FULFILLED` is a pre-Part-4 value the traveller set with one click and nothing behind it (`known-issues.md:496-500`, migration `0007_wise_giant_girl.sql:1`). No current writer. Mapping it to Reviewed would be a false "reviewed" label (R03) |
| L5 | A0 E02 table: Ready for review means "every required item is Received or Reviewed in `computeReadiness`" | Wrong in detail | Readiness reads usable facts and documents, not request or review statuses (`missions.ts:871-960`). The case-level value is `READY_FOR_APPLICANT_REVIEW` (`missions.ts:1234`) |
| L6 | U07: accurate Saving, Saved at, Not saved states | Missing | No "Saved at" or "Not saved" text anywhere under `apps/web/src` (grep) |
| L7 | Request status words | Two copies | Agency `REQ_STATUS` (`console-format.ts:14-24`) and traveller `STATUS_BADGE` (`applicant/[id]/evidence/page.tsx:22-33`) are separate tables. Both call `RECEIVED` "Submitted", which clashes with the recorded-submission meaning in PROGRAMME section 8. B09 asks for "Received" |

## 2. E02 status mapping

The six E02 groups (PROGRAMME section 8): Missing; Processing; Received or awaiting confirmation; Needs correction or clarification; Reviewed; Ready for review. "Ready for review" is case level; the other five are item level.

Rules: every item gets exactly one primary group from existing values. Freshness, sharing, safety, case stage, due date and task state are separate indicators and never change the group on their own. No new states, no new tables, no second case state machine.

### 2.1 One primary status per request item (precedence, first match wins)

1. Request `CANCELLED`, `FULFILLED` or `DECLINED`: no group. Closed, shown in history only.
2. Request `ACCEPTED`: Reviewed.
3. Request `NEEDS_REPLACEMENT`: Needs correction or clarification. The latest decision outcome gives the reason.
4. Request `RECEIVED` or `UNDER_REVIEW` (DOCUMENT kind): look at the responding document's latest version. Still processing (`UPLOADING` to `EXTRACTING`, or safety `PENDING`/`SCANNING`): Processing. Unsafe, failed or erased: Needs correction or clarification. Otherwise: Received or awaiting confirmation. FIELD kind: Received or awaiting confirmation.
5. Request `OPEN`: Missing.

Step 4's document check needs the responding document's version state, which the agency console does not load today. For Do next (scope item 5, "data the signed-in person already loads") use the request status alone; the document override applies where the case detail already loads selected evidence (`listSelectedEvidenceForOrg`, `missions.ts:1780`).

### 2.2 Full table

Columns: value; primary group (or "indicator" or "no group"); notes. Flag marks a value that does not map cleanly.

**A. Evidence request status** (`evidence_request_status`, `schema.ts:186-195`; writers `agency.ts:1847`, `:1891`, `:1975-2060`, `:2109`)

| Value | Group | Notes |
| --- | --- | --- |
| `OPEN` | Missing | Due-date indicator: Overdue, Due Today, Due in N days (logic exists, `applicant/[id]/evidence/page.tsx:45-56`) |
| `RECEIVED` | Received or awaiting confirmation | See 2.1 step 4 for the Processing and Needs correction overrides |
| `UNDER_REVIEW` | Received or awaiting confirmation | Indicator "review started" |
| `ACCEPTED` | Reviewed | |
| `NEEDS_REPLACEMENT` | Needs correction or clarification | Also holds `CONTRADICTION` and `CORRECTION_PROPOSED` decisions (`agency.ts:1975-1982`) |
| `CANCELLED` | No group | Closed by the agency |
| `FULFILLED` | No group. Flag | Legacy, no writer, never reviewed (L4). Show neutral "Fulfilled", never Reviewed |
| `DECLINED` | No group. Flag | Legacy, no writer since Part 4. Traveller declined: show neutral "Declined", no warning tone, never an adverse label (A0 open point) |

**B. Evidence request decision outcome** (`evidence_request_decision_outcome`, `schema.ts:202-208`): all indicator only (the reason line); the request status already carries the group.

| Value | Group | Notes |
| --- | --- | --- |
| `ACCEPTED` | Indicator | Mirrors request `ACCEPTED` |
| `NEEDS_REPLACEMENT` | Indicator | Reason: replacement needed |
| `CONTRADICTION` | Indicator | Reason: does not match other information |
| `CORRECTION_PROPOSED` | Indicator | Reason: a correction is proposed. Agencies propose; they never edit confirmed facts (B09) |
| `CANCELLED` | Indicator | Written by `cancelEvidenceRequest` (`agency.ts:2099`) |

**C. Document version processing state** (`document_state` via `documentVersions.processingStatus`, `schema.ts:838`, values `domain.ts:131-142`)

| Value | Group | Notes |
| --- | --- | --- |
| `UPLOADING` | Processing | Happy path `intake.ts:82-96` |
| `QUARANTINED` | Processing | Holding area before the scan, not a verdict (the verdict is safety `QUARANTINED`) |
| `SCANNING` | Processing | |
| `NORMALIZING` | Processing | |
| `EXTRACTING` | Processing | |
| `AWAITING_REVIEW` | Received or awaiting confirmation | Usable (`documents.ts:859-862`) |
| `NEEDS_ATTENTION` | Needs correction or clarification | Written for an unsafe scan (`intake.ts:685`) or a file over limits (`intake.ts:761`) |
| `APPROVED` | Received or awaiting confirmation. Flag | No product writer found (only the load-test dataset, `packages/load/src/dataset.ts:472`). Must not read as Reviewed; human review comes only from E below |
| `FAILED` | Needs correction or clarification. Flag | No writer found |
| `REJECTED` | Needs correction or clarification. Flag | No writer found |

**D. Document safety** (`document_safety_status`, `schema.ts:102-108`)

| Value | Group | Notes |
| --- | --- | --- |
| `PENDING` | Processing | |
| `SCANNING` | Processing | Written `intake.ts:790` |
| `CLEAN` | Indicator | No change to the group |
| `QUARANTINED` | Needs correction or clarification | Written `intake.ts:686`. Show plain "could not be used", never malware detail to the agency |
| `FAILED` | Needs correction or clarification. Flag | No writer found |

**E. Document review outcome** (`document_review_outcome`, `schema.ts:856-862`; latest row is current, `documents.ts:687-700`)

| Value | Group | Notes |
| --- | --- | --- |
| `PENDING` | Received or awaiting confirmation | |
| `ACCEPTED` | Reviewed | |
| `REPLACEMENT_REQUIRED` | Needs correction or clarification | |
| `DISPUTED` | Needs correction or clarification | |
| `IRRELEVANT` | No group. Flag | Means "not relevant here". Drop from the case summary with a neutral "Not needed" indicator; it is not Missing and not Reviewed |

**F. Reviewer decision on a case requirement** (`mission_decision_outcome`, `schema.ts:210`; writer `recordMissionDecision` `agency.ts:2411`)

| Value | Group | Notes |
| --- | --- | --- |
| `ACCEPTED` | Reviewed | Lifts a G `SATISFIED` requirement from Received to Reviewed |
| `REJECTED` | Needs correction or clarification | Label "Not Accepted" exists (`labels.ts:54-60`) |

**G. Requirement result state** (readiness, `missions.ts:469-476`, derived `missions.ts:1187-1200`)

| Value | Group | Notes |
| --- | --- | --- |
| `SATISFIED` | Received or awaiting confirmation | Reviewed only with an F `ACCEPTED` decision. Received is not Reviewed |
| `CRITICAL_GAP` | Missing | Required |
| `ATTENTION` | Missing | Optional indicator |
| `CONFLICTING` | Needs correction or clarification | |
| `EXPIRING_STALE` | Needs correction or clarification. Flag | Evidence exists but is too old. Could be read as Missing; chosen Needs correction plus a freshness indicator "Out of date", matching B04's "Needs refreshing or review" |
| `UNVERIFIED` | Needs correction or clarification. Flag | An answer is needed before the rule can apply (`missions.ts:1180-1183`). Clarification, not a gap |
| `NOT_APPLICABLE` | No group | Shown as "Does not apply" |

**H. Case readiness** (`OverallReadinessState`, `missions.ts:479-483`, derived `missions.ts:1218-1238`)

| Value | Group | Notes |
| --- | --- | --- |
| `READY_FOR_APPLICANT_REVIEW` | Ready for review (case level) | Completeness only, never an approval likelihood (`missions.ts:498`) |
| `NEEDS_ACTION` | Indicator | Case not ready; the item groups explain why |
| `NEEDS_REVIEW` | Indicator | Case not ready; an answer is needed |
| `MANUAL_ONLY` | No group. Flag | Manual cases get no readiness at all (`console-data.ts:196-199`), so they can never show Ready for review. The summary shows item groups only, with "Checked by hand" |

**I. Case state** (`mission_state`, `domain.ts:75-89`, transitions `missions.ts:49-71`): all 13 are a stage indicator only, never an E02 group.

`DRAFT`, `IN_PROGRESS`, `READY_FOR_REVIEW`, `UNDER_REVIEW`, `READY_TO_EXPORT`, `LOCKED`, `CLOSED`, `CANCELLED`, `INTAKE`, `IN_REVIEW`, `AWAITING_APPLICANT`, `SUBMISSION_READY`, `SUBMITTED`. Flag (naming): legacy `READY_FOR_REVIEW` and `UNDER_REVIEW` share words with E02 groups and request statuses. They must never set the E02 group. `CLOSED`, `CANCELLED`, `SUBMITTED` cases are left out of Do next.

**J. Task status** (`mission_task_status`, `schema.ts:248-253`, transitions `missions.ts:1873-1878`): indicator only. Tasks are the existing clarification channel (they can point at a requirement through `packRequirementId`, `schema.ts:2711`) and feed Do next tier 3.

| Value | Group | Notes |
| --- | --- | --- |
| `OPEN` | Indicator | Overdue when past `dueDate` |
| `IN_PROGRESS` | Indicator | Should also count as overdue when past due (H4) |
| `DONE` | Indicator | Clears |
| `CANCELLED` | Indicator | Clears |

**K. Traveller acknowledgement** (`acknowledgement_decision`, `schema.ts:217-221`)

| Value | Group | Notes |
| --- | --- | --- |
| `ACKNOWLEDGED` | Indicator | Traveller confirmed the prepared file. Not submitted |
| `REJECTED` | Needs correction or clarification (case level). Flag | A case-level answer, not tied to one item. Shown as one case line with the traveller's reason |
| `CORRECTION_REQUESTED` | Needs correction or clarification (case level). Flag | Same as above |

**L. Grant status** (`grant_status`, `schema.ts:94-100`): sharing indicator only. `ACTIVE`, `PENDING_ACCEPTANCE`, `PAUSED`, `REVOKED`, `EXPIRED`. A case without a current grant is not visible to the agency at all, so its items never appear.

**M. Upload intent** (`upload_intent_status`, `schema.ts:896-900`; traveller's own view only)

| Value | Group | Notes |
| --- | --- | --- |
| `RESERVED` | Processing | Upload under way |
| `COMPLETED` | Indicator | The document's own state takes over |
| `FAILED` | Indicator | Feeds the U07 "Not saved - retry" state, not an E02 group |

**N. Fact status** (`fact_status`, `domain.ts:107-116`; FIELD requests only): indicator only, except `CONFLICTED`.

`CONFLICTED`: Needs correction or clarification (same rule readiness uses, `missions.ts:922`). `STALE`: freshness indicator. `DECLARED`, `EXTRACTED_PENDING`, `APPLICANT_CONFIRMED`, `DOCUMENT_SUPPORTED`, `AGENCY_REVIEWED`, `SUPERSEDED`: indicator only. The request status carries the group.

**O and P. Traveller-only review items**: field and document-type suggestions (`proposal_status` `PENDING`, `APPROVED`, `REJECTED`, `schema.ts:282`) and document inconsistency flags (`inconsistency_flag_status` `PENDING`, `ACKNOWLEDGED`, `DISMISSED`, `schema.ts:277-281`). Outside E02: agencies never see them. `PENDING` feeds the traveller's Needs Attention (U03), as Home already does for suggestions (`page.tsx:110-118`).

### 2.3 Counts

88 values across 16 enums or derived types.

| Outcome | Count |
| --- | --- |
| Primary group | 36 |
| Indicator only | 40 |
| No group (closed or not applicable) | 6 |
| Outside E02 (traveller-only) | 6 |

Values that do not map cleanly (11): request `FULFILLED`, request `DECLINED`, document `APPROVED`, `FAILED`, `REJECTED`, safety `FAILED`, review `IRRELEVANT`, requirement `EXPIRING_STALE`, `UNVERIFIED`, readiness `MANUAL_ONLY`, acknowledgement `REJECTED` and `CORRECTION_REQUESTED` counted as one case-level flag.

Structural flags (3):

1. Processing is unreachable from the request status (L3). It comes only from the document or the upload intent.
2. Applicant-wide requests (`missionId` null, `schema.ts:2473-2481`) belong to no case. The agency page matches requests to cases by `applicantId` (`page.tsx:161-167`), so one request is counted on every case of that traveller. Triage and Do next must match by `missionId` when set and show applicant-wide requests once, under the traveller.
3. Case state names overlap with E02 words (I). Stage stays an indicator.

## 3. Allowlist

Approved list: `allowlists/WP-V4.txt`. Exact files WP-V4 needs, from this reading.

Change (inside the approved list):

| File | Why |
| --- | --- |
| `packages/services/src/agency.ts` | Pure exported E02 mapping (2.1) beside the request lifecycle it maps. No permission change unless Q2 says otherwise |
| `packages/services/src/agency.test.ts` | One case per value in table 2.2 A to H; R03 "no false Reviewed or Ready" |
| `packages/services/src/missions.ts` | U02 Prepare again: new draft case from a previous case or pack, three groups (Reusable, Needs refreshing or review, Missing) from `getEvidenceCandidates` (`missions.ts:974`) and `classifyStaleness`; copies references only, never approvals, grants, notes, outcomes, acknowledgements or submission status |
| `packages/services/src/missions.test.ts` | T08, T09: what is copied and what never is |
| `apps/web/src/app/app/agency/[orgId]/page.tsx` | Do next section; match requests by `missionId`; count replacement requests as waiting on the traveller |
| `apps/web/src/app/app/agency/[orgId]/console-format.ts` | Ranking and tie-break function; `countOverdueTasks` includes `IN_PROGRESS` |
| `apps/web/src/app/app/agency/[orgId]/console-format.test.ts` | Added cases only: tiers, tie-breaks, determinism, in-progress overdue |
| `apps/web/src/app/app/agency/[orgId]/page.test.tsx` | Added cases only: non-admin gets no request items and no error |
| `apps/web/src/app/app/agency/[orgId]/do-next.tsx` and `do-next.test.tsx` (new) | Do next list, owner, reason, one action; copy button announcing Copied in a live region; selectable text when the clipboard is refused |
| `apps/web/src/app/app/agency/[orgId]/follow-up-message.ts` and `follow-up-message.test.ts` (new) | Copy-ready message from the request's own fields; no ids, links, email addresses, document numbers or em dashes |
| `apps/web/src/app/app/agency/[orgId]/cases/page.tsx` and `page.test.tsx` | Case-level E02 summary on the case detail, where selected evidence is already loaded |
| `apps/web/src/app/app/applicant/[id]/evidence/page.tsx` | U07: per-item group, guidance, "Received" instead of "Submitted" |
| `apps/web/src/app/app/applicant/[id]/evidence/submit-response-form.tsx` | U07: Saving, Saved at, Not saved - retry |
| `apps/web/src/app/app/applicant/[id]/missions/page.tsx`, `create-mission-form.tsx`, `create-mission-form.test.tsx`, `actions.ts` | U02 Prepare again entry point and the three-group preview |
| `apps/web/src/app/app/applicant/[id]/expiry/ics/route.ts` (new) | B05 optional calendar export for tasks and reminder dates, kept inside the approved `applicant/[id]/**` path |
| `apps/web/src/app/app/page.tsx` | U03 Home Needs Attention per B13; include replacement requests. Overlaps WP-V3 |
| `apps/web/src/lib/ics.ts` and `ics.test.ts` | Multi-event builder with generic titles; today it builds one appointment only |
| `docs/adr/0015-agency-do-next-ranking.md` (new) | Records the ranking rule, from `docs/adr/0000-template.md`; 0014 is the latest |
| `apps/web/src/app/globals.css` | WP-V4 block only |
| `docs/upgrades/programme/**`, `docs/commercial-v1/known-issues.md` | Status, ledger rows, evidence chunk |

Needs an addition to the approved list (Q4):

| File | Why |
| --- | --- |
| `packages/services/src/index.ts` | Named re-exports (`index.ts:330` agency, `:450` missions). New service functions cannot reach the pages without one or two export lines |
| `apps/web/src/lib/labels.ts` and `labels.test.ts` | PROGRAMME section 8 puts the shared vocabulary here. The six E02 words are used by the agency console, the traveller evidence page and Home |

In the approved list but no change needed:

| File | Why not |
| --- | --- |
| `packages/services/src/packs.ts`, `packs.test.ts` | U02 needs only read access: `listPublishedPackVersions` (`packs.ts:98`), `listPackVersions` (`:429`, newest first), `getPackVersion` (`:422`), `listRequirements` (`:403`), `listPackVersionsDueForReview` (`:1210`). Attaching uses `attachPackVersion` in `missions.ts:404` |
| `packages/services/src/notification-sweep.ts`, `.test.ts` | U03 is a read projection. Task and expiry reminders, idempotency and preferences already exist; no proven change |
| `apps/web/src/app/app/agency/[orgId]/console-data.ts` | Existing loads already carry tasks, decisions, readiness and acknowledgement per case (`console-data.ts:169-200`). Changes only if Q2 is B |

Not touched: `apps/web/src/app/app/mission/[id]/**` (not in the approved list). Prepare again starts from the cases list, not the case page.

## 4. Owner decisions needed

**Q1. In what order should the agency's "Do next" list show things?**
- A (recommended): 1) things a traveller was asked for that are past their due date, oldest first (this includes ones sent back for a fix); 2) things a traveller has sent that are waiting for the agency to look at; 3) cases with tasks past their due date, most overdue first; 4) cases nobody is looking after yet (only admins see this row). When two items are level, the oldest comes first, then by name, so the list never jumps around.
- B: put "waiting for the agency to look at" first, because only the agency can move those.
- C: a different order (tell us).

Why A: due dates are promises to the traveller and to the embassy, and the review queue sits right below.

**Q2. Should case managers and reviewers see what the agency asked travellers for?** Today only owners and admins can. Everyone else sees none, so their Do next list shows only overdue tasks.
- A (recommended for this package): keep it as it is. Nothing becomes visible to anyone new.
- B: let them see requests, but only for cases assigned to them. Risk: more staff can read what was asked of a traveller and the agency's note to them. Requests made for a traveller in general, not tied to one case, would stay admin-only. This needs a new server-side permission check and its own security tests, so it should be its own reviewed change.

**Q3. "Prepare again" needs the agency's approved requirement lists.** The existing functions already give us everything, so the plan reads that file and does not edit it. The file is claimed by the Master Profile workstream.
- A (recommended): use it read-only, no edits.
- B: release the file to WP-V4 for edits.
- C: leave requirement lists out of Prepare again; copy only from the previous case.

**Q4. May WP-V4 touch two small files outside its approved list?** The services index (one or two lines so new functions reach the pages) and the shared labels file (so the six triage words live in one place, as the programme rules require).
- A (recommended): yes, both.
- B: the services index only; keep the triage words inside the agency folder.
- C: neither.

**Q5. The copy-ready follow-up message uses the agency's own note to the traveller when there is one. If that note contains a web link, an email address or a long number (such as a passport number), what should happen?**
- A (recommended): leave the note out and use the standard wording built from the request (what is needed and by when), with a one-line hint saying why.
- B: keep the note but blank out just those parts.
- C: always use the standard wording, never the agency's note.

Defaults WP-V4 will use unless the owner says otherwise (no answer needed):

- A task that has been started and is past its due date counts as overdue, matching the reminders (H4). The Overdue number on the agency page can go up.
- "Declined" and "Fulfilled" are old values with no current writer. They show in neutral words, sit in no group, and are never shown as Reviewed (L4, table A).
- Ready for Review means every required item is in, from the existing readiness check. Cases checked by hand never show it (table H).
- The traveller sees "Received" instead of "Submitted", so it cannot be mistaken for sending to the embassy (L7).
