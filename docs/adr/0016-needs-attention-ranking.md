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

Owner-approved plan (26 Oct 2026) for the B05 calendar paragraph, then the owner's direction the same day: "calendar setup must be super correct and futuristic, so later any type of upgrade, integration or configurability becomes easiest and ready". Built on branch `claude/prog-v4-calendar`; an independent review's fixes are folded in.

### Where the code lives

- **`@visastack/core/calendar`** (`packages/core/src/calendar/`, a subpath export kept out of the main core index so nothing else bundles it). Pure, framework-free, synchronous:
  - `model.ts`: the provider-neutral `CalendarEvent` (uid, sequence, status, start as a day or a UTC instant with an optional IANA zone, end as a day, an instant or a duration, title, description, location, privacy, categories, alarms, and a `source` used only for tracing inside VisaStack and never written to a file).
  - `kinds.ts`: the one registry of date kinds (`appointment`, `task_due`, `request_due`, `document_expires`): generic title, all-day or timed, default length, category. The `CalendarKind` type comes from the table, so a new kind is one entry.
  - `options.ts`: the one `CalendarExportOptions` object (`version`, `titleStyle`, `kinds`, `alarms`), its defaults, its field names, and `parseCalendarExportOptions`, which reads form data, URL parameters, a Next.js query record or a stored preference and never throws: anything missing, unknown or out of range falls back to the default for that choice.
  - `uid.ts`, `sequence.ts`, `time.ts` (wall clock to UTC with Intl), `sha256.ts`, `ics.ts` (the one serializer) and `port.ts` (the `CalendarPublisher` seam, type only).
- **`packages/services/src/attention.ts`**: `listCalendarDates` returns neutral items (kind, resource id, a day or a wall-clock time with its zone, case title, last change time). No wording.
- **`apps/web/src/lib/ics.ts`**: the thin mapping from items to events (titles from the registry, the safe case name, reminders from the options) and `buildIcsForAppointment`, which now renders through the same serializer. There is no second escaping or folding code.

### What is exported

- `listCalendarDates` takes the same gate proof and owner-only rule as `listNeedsAttention` (a sharing grant, a copied proof or a proof for another resource is refused). Sources: appointments open or started on active cases; open or started tasks with a due day on active cases that the traveller can act on (unassigned or assigned to the traveller); requests open or sent back for a fix, with a due day, not on a closed or cancelled case; current documents with an expiry day. Appointments are not filtered by assignee: the owner already sees every appointment on the case page.
- **Window and caps.** Reads start 7 days (`CALENDAR_PAST_DAYS`) before today in the traveller's time zone, earliest first, at most 50 rows per source (the page says when a list was cut), so old appointments and long-expired documents never push out upcoming dates. Anything older or undated is not listed. A file holds at most 100 events.
- **Titles.** Generic by default ("Appointment", "Task Due", "Request Due", "Document Expires"). With Add Case Names, " - <case name>" is added. The case name is cleaned (control and bidirectional characters dropped, long dashes made hyphens, cut at 80 characters without splitting one) and left out whole when it holds a link, an email address, an id or a long or grouped number in any script, using the agency follow-up message's own check (`containsUnsafeDetail`). Every event has one description line, "From VisaStack. Open VisaStack for the details.", and no place, link, id or token.
- **Privacy.** Every event is `CLASS:PRIVATE`, so a calendar shared with others shows it as busy without the title in apps that honour the class.
- **Reminders.** "Remind Me": None (default), On the Day, 1 Day Before, 1 Week Before. The options allow 0, 15, 60, 1440 and 10080 minutes, at most 3. A reminder for a timed appointment fires that many minutes before; for an all-day date it fires at 09:00 on the day, or that many whole days before, never at midnight.

### Format and permanent rules

- **UID (permanent).** `sha256("visastack:v1:<kind>:<resourceId>")`, first 32 hex characters, plus `@visastack`. Opaque, stable, distinct per kind and record, and the same in the single-appointment file, the dates file and any future feed or adapter. It must never change once people import files: a new rule would put every date in their calendar twice. Files downloaded before this scheme (the earlier `appointment-<id>@visastack` UID from the single-appointment download) will appear once more if re-imported. SHA-256 is implemented in core (checked against the published vectors and Node's) so the scheme runs synchronously anywhere.
- **SEQUENCE.** Whole seconds from 1 Jan 2026 UTC to the record's `updatedAt`, so a newer copy of a changed record always wins on re-import. Where the caller has no `updatedAt` (the single-appointment route), the time the file is made is used, which is never earlier than the last change.
- **Times.** A timed appointment is converted from its stored wall-clock time and IANA zone to UTC (`DTSTART:...Z`) with the platform's zone data, correct across daylight saving changes (a time that happens twice is the first; a time skipped moves forward past the gap). No `TZID` and no `VTIMEZONE` are written, which keeps the file valid under RFC 5545 3.2.19 and shows the right local time in every calendar app. A stored zone the runtime does not know makes the appointment an all-day event on its local date, and the page says the time zone was not recorded. Zones are now checked when an appointment is created or changed (owner and agency side): only a known IANA name is saved.
- **All-day.** `DTSTART;VALUE=DATE` with `DTEND` the next day, `TRANSP:TRANSPARENT`.
- **Serializer guarantees.** VERSION, PRODID, CALSCALE, METHOD:PUBLISH, X-WR-CALNAME "VisaStack Dates"; UID, SEQUENCE, DTSTAMP (UTC), DTSTART, DTEND, SUMMARY, DESCRIPTION, CLASS, STATUS, CATEGORIES, TRANSP, VALARM. Every value is cleaned: line breaks and control characters can never start a property, a lone surrogate becomes U+FFFD, long dashes become hyphens. CRLF line endings, folding at 75 UTF-8 octets without splitting a character. A golden-file test pins the exact output; generated-input tests check every line.

### One-time copy, preview and download

- The page says the file is a one-time copy: a later change does not reach the calendar, and a new file updates the events already imported (same UID, higher SEQUENCE) instead of adding them twice.
- The preview (a GET to the page) and the download (a POST from the page's own form to `/calendar/download`, so a long choice never makes a long address) both call `selectCalendarEvents` on the server's own items with the options from the one parser. The download is made again: anything finished or removed since the preview is left out and the rest still downloads; if nothing is left, the person goes back to the page with "Choose at least one date first." The route refuses a form whose Origin host is not the host it was sent to (403), and answers anyone but the owner with "not found".
- Download headers: `text/calendar; charset=utf-8`, attachment `visastack-dates.ics`, `private, no-store`, `nosniff`. Not audited, like the single-appointment download (open owner question).

### Roadmap seams (not built)

- **Live feed.** A per-person, revocable secret address that calendar apps poll, built from the same items, options and serializer. Needs a token table and its migration, a revoke control, rate limits, and the owner's approval. The UID and SEQUENCE rules already make a feed replace imported copies.
- **Google or Microsoft adapters.** In `packages/adapters`, behind `CalendarPublisher`. Need the owner's word and the v1.2 rule of no OAuth and no calendar credentials to be lifted.
- **Stored preferences.** A per-person `CalendarExportOptions` record; `version` and the parser are the migration path. Needs a table and migration.
