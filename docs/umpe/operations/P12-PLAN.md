# P12 plan: outcome attempts, authority requests, Field Insights (Lane F)

Base: origin/main 44d38213. Branch umpe/p12-outcomes. Reads only through exports: missions.ts, submissions.ts, P4 handoffs, P7/P9 tables (counts only).

## Audit facts
- mission_submissions: one row per reported submission, bound to the live acknowledged snapshot, self-reported, no attempt number, no pack binding. Kept after case purge.
- mission_outcomes: case-level decisions (five values), optional evidence document, not bound to any submission.
- umpe_package_handoffs (P4): pack version, checksum, manifest format, material revision, exact selections (ids). Deleted by the case purge.
- agency_collection_reviews (P9): RECEIVED / NEEDS_CORRECTION / ACCEPTED. Agency words only; never a visa decision.
- None of the existing fields proves an authority submission or receipt. Nothing is backfilled.

## Tables (TEMP migration, additive, append-only by trigger)
1. umpe_outcome_attempts: case, person, attempt number (unique per case), optional link to one mission_submissions row, binding (PACKAGE_HANDOFF / SNAPSHOT_ONLY / NONE) with handoff id and checksum, snapshot id, pack version, pack checksum, manifest format, material revision, selected version ids (ids only), route key, purpose, jurisdiction, destination, travel dates, channel, submitted date, evidence basis (SELF_REPORTED / DOCUMENT_SUPPLIED) and evidence document version.
2. umpe_outcome_events: per attempt, AUTHORITY_RECEIPT, AUTHORITY_REQUEST (source, requested catalogue document kinds) or DECISION (PENDING, APPROVED, REFUSED, WITHDRAWN, CANCELLED, OTHER), each with date, evidence basis and evidence version.
- A trigger refuses UPDATE and direct DELETE; rows go only with their case or person (cascade) or when the case purge redacts the case (a trigger on missions.purged_at deletes them, so a purged case never returns to a report).

## Services
- umpe-outcome-tables.ts: presence check (code runs before the migration).
- umpe-outcome-service.ts (owner proof, AuthorizedApplicant): recordOutcomeAttempt, trackSubmissionAsAttempt, recordAttemptEvent, listOutcomeAttempts. Binding = the latest handoff confirmed by the end of the submitted day, else the latest snapshot, else none. Evidence must be a present version of this person's document. "Verified" is never written.
- umpe-insights-suppression.ts (pure): minimum cell 10, minimum 5 people, largest contributor at most 70 percent, complementary suppression in a group.
- umpe-insights-service.ts (StaffScope FEEDBACK_VIEW, reused): funnel with explicit units, missing-outcome denominator, attempts by route and quarter, authority requests by kind and source, correction causes (P11 categories, agency correction count), checklist coverage gaps, agency review counts, data-quality counts. Purged cases, deleted people and deleted evidence never count.

## Screens
- Case page: one Application Attempts card (attempt-panel.tsx, attempt-actions.ts); recordSubmissionAction also opens the attempt for its report (best effort; otherwise Track as Attempt).
- /app/admin/insights: Field Insights, every pattern labelled Observed in VisaStack Cases, no rates or chances.
- application-memory.ts: only a helper that reads a snapshot's exact version ids. Not built: attempt events on the Application Memory timeline (gap, recorded in the hand-back).
- Not built: a navigation entry for Field Insights (navigation belongs to P13; the lead adds it).

## Tests
Two attempts keep their own decisions and evidence; unreported stays Unknown; guest receipt is not an authority submission; recorded without document is not evidenced; small cohorts suppressed; another organization denied and no ids in output; deleted data leaves the report; trigger refuses edits.

## Shared files
schema.ts, index.ts, globals.css (one block each), a11y-forms.test.tsx, enforcement.test.ts (one named staff reader of the request tables), lifecycle/travellers/classification.ts (two columns), mission page and actions (one card, one call).
