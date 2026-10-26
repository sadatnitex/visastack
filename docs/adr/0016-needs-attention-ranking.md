# ADR-0016: Needs Attention ranking for the traveller, and how Home reads it

- **Status:** Accepted
- **Date:** 2026-10-26
- **Deciders:** Owner (approved the ranking and the Needs Attention plan on 2026-10-26); WP-V4 implementation
- **PRD/Spec link:** `docs/upgrades/upgrade.v1.2.execution.md` B05 (U03) and B13; `docs/upgrades/programme/WORK-PACKAGES.md` WP-V4 item 2; `docs/upgrades/programme/WP-V4-W0-LEDGER.md` L2; ADR 0015 sections 5 and 6

## Context

Before this change Home built its own short list from three counts: open evidence requests, pending suggestions and pending sharing invitations. A request the agency sent back for a fix never reached Home (W0 ledger L2), overdue tasks and expiring documents were not on Home at all, and there was no rule for what comes first. B05 asks for one authorised read projection that prioritises overdue and blocked work over general reminders, shows each event once, gives a direct action, and shows a missing date as unknown. B13 asks Home to lead with My Records, Needs Attention and Active Requests and Work, with My Next Journey as supporting content.

Constraints:

- No new table, migration, state machine or business rule. Every source already exists: evidence requests, case tasks, case confirmations, document expiry and suggestions.
- The projection is read through the central access gate. Its baseline in the enforcement ratchet must not grow.
- Items never carry a saved value, a document number, a file name, an amount, an agency's note or a task note.

## Decision

1. **One projection.** `listNeedsAttention` in `packages/services/src/attention.ts` takes the gate's proof (`AuthorizedApplicant<'VIEW_METADATA'>`) for one applicant and refuses anything not issued to the applicant's owner, like Document Insights: what is asked of a traveller, their suggestions and their confirmations are theirs alone. Sources:
   - evidence requests that are open or sent back for a fix (declined, cancelled, received, accepted and fulfilled ones never show; declined is never overdue);
   - open or started tasks on active cases (the statuses the task reminder sweep treats as live);
   - active cases whose confirmation was undone by a later change and not confirmed again (the case page's own rule);
   - current documents whose expiry is inside the document type's reminder window or already past (`classifyExpiry` with `getReminderThresholds`); a document with no expiry date is not an item;
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

4. **Due days.** A due date is a calendar day (entered as a date, stored as UTC midnight). It is past due only once that day has ended where the person is: in the task's own time zone, else the applicant's time zone, for tasks; in the applicant's time zone for requests. Due today is not overdue. "Today" uses the reminder sweep's own local-date helper, now exported. An unknown time zone name reads as UTC rather than failing the page. A missing date is "Date Unknown", never guessed.

5. **Home.** Home calls the gate for each of the person's own applicants with `purpose: 'self'`, then the projection, then the merge. Consent still comes first. The top item is the next step; the rest are the Needs Attention section, then My Records, Active Requests and Work, My Next Journey (setup checklist or a short "plan another trip" prompt) and Permissions You Control last. Home reads at most 25 applicants and shows 8 items under the next step, saying how many are left.

## Consequences

- **Positive:** one ranked list answers "what first" for a traveller, with the same rule wherever it is read. A sent-back request reaches Home. The rule is pinned by tests that fail when a tier, tie-break, owner check or date rule is broken.
- **Negative / trade-offs:** the traveller's Home counts a request's due day in the applicant's time zone, while the agency console (ADR 0015 section 6) counts it in UTC, so the two can differ by one day near midnight. The task reminder emails are unchanged and still send their first overdue reminder on the due day itself. Documents already expired stay in tier 6 until replaced. Each source reads at most 50 rows per applicant, most urgent first.
- **Cost:** per applicant, one read each for requests, cases, tasks, confirmations, documents and suggestions, plus one threshold read per distinct document type near expiry. No per-case or per-task query.
- **Follow-ups:** the calendar export (multi-item ICS) is a separate later change. A dedicated "all attention" page would replace the "See All Applicants" link when the list is cut. T13 (attention deduplication on staging) has not been run.

## Alternatives considered

- **Reusing the agency Do Next order (ADR 0015)** - not chosen: it ranks what agency staff review, while the traveller's first job is what is late or sent back to them.
- **Reading "what changed" for every case (`listChangesSinceConfirmed`)** - not chosen for Home: it needs a case-level proof and a snapshot comparison per case. Home only needs to know that a case changed; the case page shows what changed.
- **Loading every suggestion (`listPendingProposals`)** - not chosen: Home needs a count, so the projection counts with the same filter instead of loading each suggestion's evidence.
- **A stored attention queue** - not chosen: the list is cheap to compute from live rows, and a stored copy could drift from the statuses it summarises.
