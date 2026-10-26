# ADR-0015: agency Do Next ranking and the triage groups it reads

- **Status:** Accepted
- **Date:** 2026-10-25
- **Deciders:** Owner (approved option A on 2026-10-25, WP-V4 W0 ledger Q1, Q2 and Q5); WP-V4 implementation
- **PRD/Spec link:** `docs/upgrades/upgrade.v1.2.execution.md` E02; `docs/upgrades/programme/PROGRAMME.md` section 8; `docs/upgrades/programme/WORK-PACKAGES.md` WP-V4 items 4 and 5; `docs/upgrades/programme/WP-V4-W0-LEDGER.md` sections 2 and 4

## Context

Agency staff open the dashboard to decide what to do first. Before WP-V4 the page had counts, a case table sorted by a loose weight, and a separate list of recent requests, so "what first" had to be worked out by hand. The v1.2 spec (E02) asks for one triage vocabulary mapped from existing statuses, and WP-V4 asks for a short ranked list with an owner, a reason and one action per item. The ranking order and any change to who can see evidence requests are owner gates.

Constraints:

- No new table, migration or second state machine. Groups are mapped from the statuses the product already stores (W0 ledger section 2).
- Evidence requests stay administrator data. `listEvidenceRequestsForOrg` refuses anyone else, and the console never asks for them on a member's behalf.
- The list may use only data the dashboard already loads for this person, so it cannot show an item for a case the person cannot already see.
- A follow-up message may be prepared for the agency, but the product never sends it.

## Decision

1. **Triage groups.** Every item gets exactly one primary group: Missing, Processing, Received or Awaiting Confirmation, Needs Correction or Clarification, or Reviewed. Ready for Review is a case-level statement. The mapping is a set of pure functions in `packages/services/src/agency.ts` (`evidenceRequestTriageGroup`, `requirementTriageGroup`, `summarizeCaseTriage`) with no database read. Freshness, safety, due dates, case stage and task state are indicators only. Received is never Reviewed; legacy Fulfilled and Declined rows are closed and never Reviewed; a case checked by hand never gets Ready for Review; a case with an open, sent-back or still-processing item is not Ready for Review even when the checklist is complete.

2. **Do Next ranking** (owner option A), built by `buildDoNext` in `apps/web/src/app/app/agency/[orgId]/do-next.ts`:
   1. Items asked of a traveller that are past their due date (Missing or Needs Correction, including items sent back for a fix), oldest due date first.
   2. Items a traveller sent that are waiting for the agency to review (Received or Awaiting Confirmation).
   3. Cases with overdue tasks (open or started, past due), most overdue first.
   4. Cases with nobody assigned, for administrators only.

   Ties are broken by oldest created, then by title, then by an internal key, so the order is the same on every visit and for any input order. Closed, cancelled and submitted cases are left out. A case appears once among the case rows; one with overdue tasks and nobody assigned shows in row 3 with "Nobody assigned" as its owner.

3. **Who sees what** (owner option A for Q2: no change). Rows 1 and 2 are built only for administrators, from requests they already load. A member who is not an administrator gets rows 3 only, with no error. A request that names a case is shown only when that case is in view; a request made for a traveller in general is shown once, under the traveller.

4. **Follow-up message** (owner option A for Q5). Built in `follow-up-message.ts` from the request's own fields: what is needed, the case title, the due date and the agency's name, with the agency's own note as the body when it is safe. Any field holding a link, an email address, an id or a long number is dropped for plain wording; a dropped note falls back to the standard wording and the screen says why. Long dashes become hyphens. The message is shown for review and copied by the agency; the copy result is announced in a polite live region, and when the clipboard is refused the text is selected for copying by hand.

5. **Same numbers everywhere** (independent review, 2026-10-25). Waiting on the traveller means open or sent back for a fix, in the dashboard count, the Waiting on Traveller view and Do Next row 1. The "Nothing is overdue, unassigned or waiting" line shows only when the counts are zero and Do Next is empty. The per-case "open request" badges in the case table still include requests made for the traveller in general (shown on each of that traveller's cases), while the case summary ("Where Things Stand") leaves them out by design, because they belong to no one case; Do Next shows them once, under the traveller.

6. **Past due starts on the same day for tasks and requests.** A due date is a calendar day (entered as a date, stored as UTC midnight). Both are past due only once that day has ended (`daysUntilDateOnly` below zero), so a task or request due today is not yet past due. The reminder emails (`computeTaskDeadlineThreshold` in `notification-sweep.ts`) are unchanged: they send the first "overdue" reminder on the due day itself, counted in the task's own time zone. Changing the emails would widen this package, so the console and the emails can differ by up to one day.

7. **The answered file decides, where the console may look.** For a received document request, the console reads the newest version of the answered file through the central access gate (`requireAccess` with MANAGE on that case, or on the traveller for a general request, acting for the organization) and `listRespondingDocumentStatesForOrg`, administrators only. A newer version still being checked is Processing (left out of Do Next row 2); one that is unsafe, failed or erased is Needs Correction and shows in row 1 only when past due. When the gate refuses, the file is not read and the request status alone decides.

8. **A member never sees Ready for Review.** Someone who cannot see requests cannot know that nothing else is waiting, so a complete checklist reads "Checklist Complete" for them, never the administrator's Ready for Review.

9. **The note check is cautious.** A note is left out when it holds an at sign (including the full-width form), an email spelled out ("name at gmail dot com", "name(at)gmail(dot)com"), a link, an id, six digits in a row, eight digits close together split by spaces, slashes, underscores, dots, hyphens, plus signs or brackets, or a code such as A0123 4567. Any decimal digit counts (Bangla and full-width too), and the text is compared in its plain (NFKC) form. A date written in digits, such as 10/12/2026, also trips the check and gets the standard wording. Figure, en, em and horizontal-bar dashes, the minus sign and the two- and three-em dashes all become hyphens.

## Consequences

- **Positive:** one ranked list answers "what first" without opening a case, using the same words everywhere (`apps/web/src/lib/labels.ts`). Nothing new becomes visible to anyone. The ranking is deterministic and covered by tests that fail when a tier, tie-break or permission guard is broken.
- **Negative / trade-offs:** members who are not administrators do not see request items, so their list holds overdue tasks only. The Processing group is reachable only where the responding document's state is loaded; the dashboard uses the request status alone, which is exact for the current lifecycle (a request becomes Received only after its file passed checks). The cautious note check can also drop a harmless note that happens to contain a long number or something shaped like a web address.
- **Follow-ups:** letting reviewers see requests for their own assigned cases would be a permission change and needs its own owner decision and review. A timed measure of "top three actions findable without opening a case" (scorecard X10) still needs a staging agency account. Request presets and reviewed item guidance (R04) are not part of this decision.

## Alternatives considered

- **Review queue first (owner option B)** - not chosen: due dates are promises to the traveller and to the embassy, so past-due items lead and the review queue sits right below.
- **Showing requests to members for assigned cases (Q2 option B)** - not chosen for this package: it widens who can read what was asked of a traveller and the agency's note to them.
- **Blanking risky parts of the agency note (Q5 option B)** - not chosen: a partly blanked note can read oddly or still leak context; the standard wording is safer and the screen explains the swap.
- **A stored ranking or a new queue table** - not chosen: the list is cheap to compute from rows already loaded, and a stored copy could drift from the live statuses.

## Amendment, 26 Oct 2026: the traveller's time zone decides past due

- **Decision (owner, 26 Oct 2026):** the traveller's time zone decides when an agency request is past due, everywhere: the traveller's Home, the traveller's evidence page and the agency's Do Next list. This replaces the UTC reading in section 6 for requests; section 6 is left as written for the record.
- **What changed:** the console reads the traveller's time zone with the cases and requests it already loads (`listMissionsForOrganization`, `listVisibleMissionsForMember` and `listEvidenceRequestsForOrgDetailed` now carry `applicantTimezone`). It is used only to decide when a due day ends and is never shown; client components receive only the props they did before (the Cases page maps each task to its shown fields, so a task's own time zone stays on the server; a test checks it). A request is past due once its due day has ended in the traveller's time zone, and UTC is used only when the traveller's zone cannot be read. Tasks follow the same rule (their own time zone first, then the traveller's) in the Overdue count, the Overdue quick view and Do Next row 3, and the follow-up message's due line uses the same day. All of these call one helper, `daysUntilDueDay` in `packages/services/src/attention.ts`, through `daysUntilDue` in `console-format.ts`.
- **Still different:** the task reminder emails (`computeTaskDeadlineThreshold`) are unchanged and send their first overdue reminder on the due day itself.
- **Tests:** `apps/web/src/app/app/applicant/[id]/evidence/due-label.test.ts` checks a request due on the same day for a traveller in Asia/Dhaka and one in America/Los_Angeles at 23:59 and 00:01 local time, and the shared day rule Home uses, the evidence page and Do Next give the same answer (Home's own path is covered in `packages/services/src/attention.test.ts`; the follow-up message's due line has its own Dhaka and Los Angeles test).
