import type { AccountExport } from './export';

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

function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text: string;
  if (value instanceof Date) {
    text = value.toISOString();
  } else if (typeof value === 'object') {
    text = JSON.stringify(value);
  } else {
    text = String(value);
  }
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
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
  const lines = [columns.join(',')];
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
export function buildExportCsvTables(data: AccountExport): readonly ExportCsvTable[] {
  const applicants = data.applicants;
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
      applicants.map((a) => a.applicant),
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
      applicants.flatMap((a) => a.documents.map((d) => d.document)),
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
      applicants.flatMap((a) => a.missions.map((m) => m.mission)),
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
      applicants.flatMap((a) => a.evidenceRequests),
    ),
    table(
      'ai_extraction_runs.csv',
      applicants.flatMap((a) => a.aiRuns.map((r) => r.run)),
    ),
    table(
      'field_proposals.csv',
      applicants.flatMap((a) => a.aiRuns.flatMap((r) => r.proposals)),
    ),
  ];
}
