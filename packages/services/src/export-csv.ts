import { type ReferenceKind, csvCell } from '@visastack/core';
import type { AccountExport, ExportLifecycleLabel } from './export';

/**
 * CSV rendering of the account export (master directive Part 7 §14:
 * "readable JSON/CSV metadata"). Renders the exact same data already
 * assembled by {@link exportAccount} as a set of flat tables, one per
 * entity kind -- never a separate query, so a CSV table can never contain
 * data the JSON export doesn't also have.
 *
 * Deliberately excludes original document bytes: those need the
 * directive's own "Large export" infrastructure (async durable job,
 * encrypted transient storage, ZIP safety for user-controlled names) that
 * this synchronous, metadata-only bundle does not have and should not
 * pretend to. See export.ts's `knownGaps`.
 */
export interface ExportCsvTable {
  readonly name: string;
  readonly rowCount: number;
  readonly csv: string;
}

const CRLF = '\r\n';

/**
 * Every cell of the account export, headers included, goes through `csvCell` from
 * @visastack/core: formula cells (`=`, `+`, `-`, `@`, tab, carriage return, also after leading
 * spaces) are defused, so a draft title an AI app wrote cannot run in a spreadsheet (S21 round 3).
 */
function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return String(value);
  }
  if (value instanceof Date) return csvCell(value.toISOString());
  if (typeof value === 'object') return csvCell(JSON.stringify(value));
  return csvCell(String(value));
}

/**
 * Renders a flat array of same-shaped records as CSV. Columns are taken
 * from the first row's own keys -- every row here comes from the same
 * Drizzle table, so this can never drift from the schema by hand-listing
 * columns that later go stale.
 */
export function rowsToCsv(rows: readonly Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const columns = Object.keys(rows[0] as Record<string, unknown>);
  const lines = [columns.map((column) => csvCell(column)).join(',')];
  for (const row of rows) {
    lines.push(columns.map((column) => escapeCsvField(row[column])).join(','));
  }
  return lines.join(CRLF);
}

function table(name: string, rows: readonly Record<string, unknown>[]): ExportCsvTable {
  return { name, rowCount: rows.length, csv: rowsToCsv(rows) };
}

/**
 * Builds every CSV table for an account export. Tables with zero rows are
 * still returned (with `rowCount: 0` and empty `csv`) so callers can
 * decide for themselves whether to include an empty file in a bundle --
 * this module has no opinion on packaging.
 */
/**
 * Visible reference codes (ADR 0018) of records already in the export, per
 * type: entity id to `C-7K2Q9M`. A type without a map gets no column; a
 * record without a code gets an empty cell.
 */
export type ExportReferenceCodes = Partial<Record<ReferenceKind, ReadonlyMap<string, string>>>;

function withReferenceCodes<T extends { readonly id: string }>(
  rows: readonly T[],
  codes: ReadonlyMap<string, string> | undefined,
): readonly Record<string, unknown>[] {
  if (!codes) return rows;
  return rows.map((row) => ({ ...row, reference_code: codes.get(row.id) ?? '' }));
}

/**
 * The lifecycle label of each record ("Archived" or "Scheduled for removal", LC-A2) as a
 * `record_status` column, empty for a current record. Keyed by id, like the reference codes, and
 * added only when some record has a label, so an export with nothing archived or deleted is
 * exactly as before. A separate column name, so a table's own `status` is never overwritten.
 */
function withLifecycleStatus(
  rows: readonly Record<string, unknown>[],
  labels: ReadonlyMap<string, ExportLifecycleLabel>,
): readonly Record<string, unknown>[] {
  if (labels.size === 0) return rows;
  return rows.map((row) => {
    const { id } = row;
    return { ...row, record_status: labels.get(String(id)) ?? '' };
  });
}

/** Each labelled record's id and label. */
function lifecycleLabels(
  entries: readonly { readonly id: string; readonly status?: ExportLifecycleLabel }[],
): ReadonlyMap<string, ExportLifecycleLabel> {
  return new Map(entries.flatMap((entry) => (entry.status ? [[entry.id, entry.status]] : [])));
}

export function buildExportCsvTables(
  data: AccountExport,
  codes: ExportReferenceCodes = {},
): readonly ExportCsvTable[] {
  const applicants = data.applicants;
  const documents = applicants.flatMap((a) => a.documents);
  const applicantLabels = lifecycleLabels(
    applicants.map((a) => ({ id: a.applicant.id, ...(a.status ? { status: a.status } : {}) })),
  );
  const documentLabels = lifecycleLabels(
    documents.map((d) => ({ id: d.document.id, ...(d.status ? { status: d.status } : {}) })),
  );
  return [
    table('account.csv', [data.account]),
    table('consents.csv', [data.consents]),
    table('consent_history.csv', data.consentHistory),
    table('memberships.csv', data.memberships),
    table('assignments.csv', data.assignments),
    table('grants_received.csv', data.grantsReceived),
    table('mission_notes_authored.csv', data.missionNotesAuthored),
    table('product_events.csv', data.productEvents),
    table('audit_events.csv', data.auditEvents),
    table(
      'applicants.csv',
      withLifecycleStatus(
        withReferenceCodes(
          applicants.map((a) => a.applicant),
          codes.P,
        ),
        applicantLabels,
      ),
    ),
    table(
      'facts.csv',
      applicants.flatMap((a) => a.facts.map((f) => f.fact)),
    ),
    table(
      'fact_versions.csv',
      applicants.flatMap((a) => a.facts.flatMap((f) => f.versions)),
    ),
    table(
      'documents.csv',
      withLifecycleStatus(
        withReferenceCodes(
          documents.map((d) => d.document),
          codes.D,
        ),
        documentLabels,
      ),
    ),
    table(
      'document_versions.csv',
      applicants.flatMap((a) => a.documents.flatMap((d) => d.versions)),
    ),
    table(
      'document_name_versions.csv',
      applicants.flatMap((a) => a.documents.flatMap((d) => d.nameVersions)),
    ),
    table(
      'document_scan_results.csv',
      applicants.flatMap((a) => a.documents.flatMap((d) => d.scanResults)),
    ),
    table(
      'missions.csv',
      withReferenceCodes(
        applicants.flatMap((a) => a.missions.map((m) => m.mission)),
        codes.C,
      ),
    ),
    table(
      'mission_snapshots.csv',
      applicants.flatMap((a) => a.missions.flatMap((m) => m.snapshots)),
    ),
    table(
      'grants_granted.csv',
      applicants.flatMap((a) => a.grantsGranted),
    ),
    table(
      'evidence_requests.csv',
      withReferenceCodes(
        applicants.flatMap((a) => a.evidenceRequests),
        codes.R,
      ),
    ),
    table(
      'ai_extraction_runs.csv',
      applicants.flatMap((a) => a.aiRuns.map((r) => r.run)),
    ),
    table(
      'field_proposals.csv',
      applicants.flatMap((a) => a.aiRuns.flatMap((r) => r.proposals)),
    ),
    table(
      'mission_tasks.csv',
      applicants.flatMap((a) => a.missions.flatMap((m) => m.tasks)),
    ),
    table(
      'ai_task_origins.csv',
      applicants.flatMap((a) => a.missions.flatMap((m) => m.aiTaskOrigins)),
    ),
    table(
      'ai_drafts.csv',
      applicants.flatMap((a) => a.aiDrafts),
    ),
    table(
      'ai_connections.csv',
      applicants.flatMap((a) => a.aiConnections),
    ),
  ];
}
