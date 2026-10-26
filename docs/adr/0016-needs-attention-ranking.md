# ADR-0016: Needs Attention ranking for the traveller, and how Home reads it

- **Status:** Accepted
- **Date:** 2026-10-26
- **Deciders:** Owner (approved the ranking and the Needs Attention plan on 2026-10-26, and decided on 2026-10-26 that the traveller's time zone decides past due everywhere); WP-V4 implementation
- **PRD/Spec link:** `docs/upgrades/upgrade.v1.2.execution.md` B05 (U03) and B13; `docs/upgrades/programme/WORK-PACKAGES.md` WP-V4 item 2; `docs/upgrades/programme/WP-V4-W0-LEDGER.md` L2; ADR 0015 sections 5 and 6

## Context

Before this change Home built its own short list from three counts: open evidence requests, pending suggestions and pending sharing invitations. A request the agency sent back for a fix never reached Home (W0 ledger L2), overdue tasks and expiring documents were not on Home at all, and there was no rule for what comes first. B05 asks for one authorised read projection that prioritises overdue and blocked work over general reminders, shows each event once, gives a direct action, and shows a missing date as unknown. B13 asks Home to lead with My Records, Needs Attention and Active Requests and Work, with My Next Journey as supporting content.

Constraints:

- No new table, migration, state machine or business rule. Every source already exists: evidence requests, case tasks, case confirmations, document expiry and suggestions.
- The projection is read through the central access gate. Its baseline in the enforcement ratchet must not grow.
- Items never carry a saved value, a document number, a file name, an amount, an agency's note or a task note.

## Decision

1. **One projection.** `listNeedsAttention` in `packages/services/src/attention.ts` takes the gate's proof (`AuthorizedApplicant<'VIEW_METADATA'>`) for one applicant and refuses anything not issued to the applicant's owner, like Document Insights: what is asked of a traveller, their suggestions and their confirmations are theirs alone. Sources:
   - evidence requests that are open or sent back for a fix (declined, cancelled, received, accepted and fulfilled ones never show; declined is never overdue). A request on a closed or cancelled case is left out of Needs Attention but is still listed on the traveller's evidence page, which shows every request;
   - open or started tasks on active cases (the statuses the task reminder sweep treats as live) that the traveller can act on: unassigned, or assigned to the traveller's own account. A task the agency gave one of its staff is the agency's to do and never becomes the traveller's next step;
   - active cases whose confirmation was undone by a later change and not confirmed again (the case page's own rule);
   - current documents whose expiry day is inside the document type's reminder window (no more days left than its widest threshold, the window `classifyExpiry` uses for reminders) or has ended. The expiry date is a calendar day like a due date: a document is expired only once that day has ended in the applicant's time zone (`daysUntilDueDay`). A document with no expiry date is not an item;
   - pending suggestions, as one item per applicant with the count.

2. **Ranking** (owner approval, 26 Oct 2026). An item takes the highest tier that applies:
   1. Overdue (past its due day), oldest due first.
   2. Sent back for a fix (an evidence request in Needs Replacement).
   3. Due within 7 days, today included, soonest first.
   4. A case changed since the person confirmed it.
   5. Other open requests and tasks, dated before undated (dated: soonest first).
   6. Documents expiring soon or already expired, earliest date first.
   7. Suggestions waiting and sharing invitations waiting.

   Inside a tier: dated before undated, earliest date first, then oldest created, then title, then the item key, so the order is the same for any input order. An overdue request that was sent back is tier 1.

3. **Pure merge.** `rankAttentionItems` is a pure function. It works each item's tier out again (so a hand-built item cannot claim a higher one) and keeps each key (`${kind}:${resourceId}`) once, in its highest tier. Home uses it to merge the lists of all the person's applicants with the account-level sharing invitation item.

4. **Due days.** A due date is a calendar day (entered as a date, stored as UTC midnight). It is past due only once that day has ended where the traveller is: in the task's own time zone, else the applicant's time zone, for tasks; in the applicant's time zone for requests (owner decision, 26 Oct 2026; the same rule on the evidence page and the agency's Do Next list, ADR 0015 amendment). Due today is not overdue. "Today" uses the reminder sweep's own local-date helper, now exported. An unknown time zone name reads as UTC rather than failing the page. A missing date is "Date Unknown", never guessed.

5. **Home.** Home calls the gate for each of the person's own applicants with `purpose: 'self'`, then the projection, then the merge. Consent still comes first. The top item is the next step; the rest are the Needs Attention section, then My Records, Active Requests and Work, My Next Journey (setup checklist or a short "plan another trip" prompt, one heading) and Permissions You Control last. Home reads at most 25 applicants, oldest record first then by id so the same people are read on every visit, and says so in Needs Attention and My Records when some are left out. When people are left out and nothing is waiting for the ones read, the next step says "Up to Date for the People Shown" with the count, never "You Are Up to Date". It shows 8 items under the next step, saying how many are left.

## Consequences

- **Positive:** one ranked list answers "what first" for a traveller, with the same rule wherever it is read. A sent-back request reaches Home. The rule is pinned by tests that fail when a tier, tie-break, owner check or date rule is broken.
- **Negative / trade-offs:** the task reminder emails are unchanged and still send their first overdue reminder on the due day itself, so an email can arrive a day before Home, the evidence page and the agency console call a task past due. The document expiry emails still use `classifyExpiry`'s raw time gap, so near midnight an email and Home can differ by a day. Documents already expired stay in tier 6 until replaced.
- **Cost:** per applicant, one read each for requests, cases, tasks, confirmations, documents and suggestions, plus one reminder-threshold read per distinct document type among the (up to 50) documents with an expiry date. The gate already loaded the applicant, so the projection reads requests and cases directly with only the columns an item needs (never the agency's note) instead of calling `listEvidenceRequestsForApplicant` and `listMissions`, which would each read the applicant again. Tasks and documents are capped at 50 rows each, most urgent first; requests (only open, sent back, received and under review), cases and confirmations are not capped. No per-case or per-task query.
- **Follow-ups:** the calendar export (multi-item ICS) is a separate later change. A dedicated "all attention" page would replace the "See All Applicants" link when the list is cut. T13 (attention deduplication on staging) has not been run.

## Alternatives considered

- **Reusing the agency Do Next order (ADR 0015)** - not chosen: it ranks what agency staff review, while the traveller's first job is what is late or sent back to them.
- **Reading "what changed" for every case (`listChangesSinceConfirmed`)** - not chosen for Home: it needs a case-level proof and a snapshot comparison per case. Home only needs to know that a case changed; the case page shows what changed.
- **Loading every suggestion (`listPendingProposals`)** - not chosen: Home needs a count, so the projection counts with the same filter instead of loading each suggestion's evidence.
- **A stored attention queue** - not chosen: the list is cheap to compute from live rows, and a stored copy could drift from the statuses it summarises.

## Calendar export, 26 Oct 2026

Owner-approved plan (26 Oct 2026) for the B05 calendar paragraph. Built on branch `claude/prog-v4-calendar`.

- **What is exported.** `listCalendarDates` in `packages/services/src/attention.ts` takes the same gate proof as `listNeedsAttention` and the same owner-only rule (a sharing grant, a copied proof or a proof for another resource is refused). It returns the traveller's dated items only: appointments that are open or started on active cases; open or started tasks with a due day on active cases that the traveller can act on (unassigned or assigned to the traveller); evidence requests that are open or sent back for a fix, with a due day, not on a closed or cancelled case; and current documents with an expiry day. Anything without a date is not a calendar item. Appointments are not filtered by assignee: the owner already sees every appointment on the case page and can download each one on its own.
- **What an item carries.** A key (`${kind}:${resourceId}`), the kind, the date (a day, or a wall-clock local date-time with its time zone) and the case title. No note, task description, appointment title or place, saved value, file name, document number or amount.
- **Generic titles.** "Appointment", "Task Due", "Request Due", "Document Expires" (`CALENDAR_EVENT_TITLES` in `apps/web/src/lib/labels.ts`). When the person ticks Add Case Names, " - <case title>" is added; the case title is cleaned (control characters dropped, long dashes made hyphens, any word with six or more digits in a row replaced by "(number hidden)", 80 characters at most). Every event has one description line, "From VisaStack. Open VisaStack for the details.", with no link, id or token.
- **One-time copy.** The page says so in plain words. The file is built on request and never updated; there is no subscription feed, no OAuth and no calendar credential. A UID is `<kind>-<id>@visastack`, so importing a newer file updates the same events in most calendar apps instead of duplicating them, and an appointment has the same UID as its single-appointment file.
- **All-day handling.** A due day or expiry day is `DTSTART;VALUE=DATE` with `DTEND` the next day, marked `TRANSP:TRANSPARENT` so it does not show the person as busy. The page says dates without a time are all-day events.
- **Time zones.** An appointment keeps its stored wall-clock time with `TZID=<IANA name>`, one hour long, like the existing single-appointment file. No VTIMEZONE block is emitted; calendar apps resolve IANA names. A stored zone name that is not well formed or not known to the runtime becomes no zone (floating time, the same clock time in the calendar's own zone), never a guessed one, and the preview says so.
- **Preview equals file.** The page and the download route both call `selectCalendarEvents` on the server's own items; only the chosen keys and the case-names choice come from the request. A key that is not one of the person's items is ignored without detail. Nothing chosen sends the person back to the page with "Choose at least one date first."
- **Caps.** At most 50 rows from each of the four sources (earliest first; the page says when a list was cut) and at most 100 events per file (the earliest chosen; the preview counts the rest). One case read, then four reads in parallel, no per-item query.
- **Download.** `text/calendar; charset=utf-8`, attachment `visastack-dates.ics`, `Cache-Control: private, no-store`, `nosniff`. Not audited, like the single-appointment download.
