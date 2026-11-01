/*
 * Every column in the database that points at a traveller record (`applicants`), and what a row
 * there means for "Remove Empty Record" (LC-E, owner decision D9).
 *
 * - `DATA`: a row here is something the person, an agency or the service keeps for this traveller.
 *   Any row makes the record not empty, so it can be archived but never removed.
 * - `UNFINISHED`: a row blocks removal only while its work is still running (a file still being
 *   destroyed). A finished row is history and does not block.
 * - `OWN_STATE`: the record's own lifecycle row, which goes with it.
 * - `KEPT`: a log that stays after the record is gone and holds no foreign key (the pseudonymous
 *   audit chain). It never blocks.
 *
 * The list is fixed on purpose. classification.test.ts reads every foreign key and every
 * `*applicant_id` column of a fully migrated database and fails when one is missing here, so a
 * new table that points at travellers cannot be forgotten: its author has to decide whether it
 * holds data. Table names are literal text, never `schema.X` read at module load.
 */

export type ApplicantReferenceKind = 'DATA' | 'UNFINISHED' | 'OWN_STATE' | 'KEPT';

export interface ApplicantReference {
  readonly table: string;
  readonly column: string;
  readonly kind: ApplicantReferenceKind;
  /** For `UNFINISHED`: the column and the one value that means the work is finished. */
  readonly finished?: { readonly column: string; readonly value: string };
  /** The column has no index of its own, so the emptiness check asks it last. */
  readonly unindexed?: true;
}

export const APPLICANT_REFERENCES: readonly ApplicantReference[] = [
  // The profile and everything typed or approved into it.
  { table: 'facts', column: 'applicant_id', kind: 'DATA' },
  { table: 'field_proposals', column: 'applicant_id', kind: 'DATA' },
  { table: 'profile_field_exemptions', column: 'applicant_id', kind: 'DATA' },
  { table: 'profile_section_states', column: 'applicant_id', kind: 'DATA' },
  { table: 'applicant_photos', column: 'applicant_id', kind: 'DATA' },
  // Documents, uploads in progress and what was read from them.
  { table: 'documents', column: 'applicant_id', kind: 'DATA', unindexed: true },
  { table: 'upload_intents', column: 'applicant_id', kind: 'DATA' },
  { table: 'document_type_proposals', column: 'applicant_id', kind: 'DATA' },
  { table: 'document_inconsistency_flags', column: 'applicant_id', kind: 'DATA' },
  { table: 'ocr_runs', column: 'applicant_id', kind: 'DATA' },
  { table: 'ai_classification_runs', column: 'applicant_id', kind: 'DATA' },
  { table: 'ai_extraction_runs', column: 'applicant_id', kind: 'DATA' },
  { table: 'ai_inconsistency_runs', column: 'applicant_id', kind: 'DATA' },
  { table: 'ai_drafts', column: 'applicant_id', kind: 'DATA' },
  { table: 'issuer_verifications', column: 'applicant_id', kind: 'DATA' },
  // Cases, sharing and the people who work with this traveller.
  { table: 'missions', column: 'applicant_id', kind: 'DATA', unindexed: true },
  { table: 'grants', column: 'applicant_id', kind: 'DATA' },
  { table: 'grant_case_exclusions', column: 'applicant_id', kind: 'DATA' },
  { table: 'sharing_invitations', column: 'applicant_id', kind: 'DATA' },
  { table: 'support_grants', column: 'applicant_id', kind: 'DATA' },
  { table: 'evidence_requests', column: 'applicant_id', kind: 'DATA' },
  { table: 'contributor_requests', column: 'applicant_id', kind: 'DATA' },
  { table: 'client_invitations', column: 'accepted_applicant_id', kind: 'DATA', unindexed: true },
  { table: 'acknowledgements', column: 'subject_applicant_id', kind: 'DATA', unindexed: true },
  // Connections and messages.
  { table: 'ai_connections', column: 'applicant_id', kind: 'DATA' },
  { table: 'calendar_feeds', column: 'applicant_id', kind: 'DATA' },
  { table: 'notifications', column: 'applicant_id', kind: 'DATA', unindexed: true },
  // Protection and lifecycle records held for this traveller.
  { table: 'legal_holds', column: 'applicant_id', kind: 'DATA' },
  { table: 'document_lifecycle', column: 'applicant_id', kind: 'DATA' },
  { table: 'document_removal_requests', column: 'applicant_id', kind: 'DATA' },
  // Removal Records anchored on this record (for example a family member removed earlier).
  // Removing the record would take them with it, so it is not empty while it holds any.
  { table: 'deletion_receipts', column: 'applicant_id', kind: 'DATA' },
  // A file of this traveller still being destroyed; a verified job is history.
  {
    table: 'erasure_jobs',
    column: 'applicant_id',
    kind: 'UNFINISHED',
    finished: { column: 'status', value: 'VERIFIED' },
    unindexed: true,
  },
  { table: 'applicant_lifecycle', column: 'applicant_id', kind: 'OWN_STATE' },
  { table: 'audit_events', column: 'applicant_id', kind: 'KEPT' },
];
