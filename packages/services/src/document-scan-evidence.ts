import { inArray } from 'drizzle-orm';
import { type Db, schema } from './db';

/**
 * What was really done to one document version, read from that version's own scan records
 * (`document_scan_results`, append-only). It is the only source for saying a file was scanned for
 * viruses.
 *
 * Why it exists. `document_versions.safety_status = CLEAN` means "passed the checks that were
 * configured when this file arrived". With the built-in checker those are structural only (file
 * type, size, PDF structure): no virus scan ran. The old CLEAN value is kept exactly as it is for
 * every access rule (see `isDocumentVersionUsable`); this module only adds the honest reading of it.
 *
 * Rules that make a false "scanned" impossible:
 *  - Only a record written by a trusted antivirus engine counts (TRUSTED_VIRUS_SCANNER_NAMES). The
 *    built-in structural checker and the content-limits check are different names and never count.
 *  - The record must be for this exact version, must be a real verdict (not an errored attempt)
 *    and must say the file is safe.
 *  - The newest antivirus record decides. A later errored or unsafe record cancels an earlier pass.
 *  - The version must still be CLEAN. A held or failed file is never shown as scanned.
 *  - Nothing here reads a global switch: a file scanned while the engine was on stays scanned when
 *    the engine is later off, and a file added before the engine existed stays format checked when
 *    the engine is later on.
 *
 * Read-only and not an access check: callers authorise the person and the version first, exactly
 * as they already do for the document itself. The result holds no scanner name, version, stored
 * detail or storage key, so it is safe to hand to a page.
 */

/**
 * Scanner names in `document_scan_results.scanner_name` that are a real antivirus engine
 * (`ClamAvScanner.name`). A guard test in apps/web ties this list to the adapters' own names.
 */
export const TRUSTED_VIRUS_SCANNER_NAMES: ReadonlySet<string> = new Set(['clamav']);

export type VersionScanKind =
  /** A trusted antivirus engine scanned this exact file and found nothing. */
  | 'VIRUS_SCANNED'
  /** Passed the built-in file type and structure checks only. No virus scan has been done. */
  | 'FORMAT_CHECKED'
  /** Not picked up for checking yet. */
  | 'WAITING'
  /** A check is in progress. */
  | 'CHECKING'
  /** A virus scan was tried and could not finish; it will be retried. */
  | 'DELAYED'
  /** The checks held the file back. It cannot be opened. */
  | 'HELD'
  /** The checks could not be completed for this file. It cannot be opened. */
  | 'FAILED';

export interface VersionScanEvidence {
  readonly kind: VersionScanKind;
  /** When the virus scan finished, only for VIRUS_SCANNED. */
  readonly scannedAt: string | null;
}

export type VersionSafetyStatus = 'PENDING' | 'SCANNING' | 'CLEAN' | 'QUARANTINED' | 'FAILED';

export interface ScanRecordForEvidence {
  readonly scannerName: string;
  readonly scanErrored: boolean;
  readonly safe: boolean;
  readonly scannedAt: Date;
}

/** The pure rule. Exported for tests and for callers that already hold the rows. */
export function deriveVersionScanEvidence(input: {
  readonly safetyStatus: VersionSafetyStatus | null;
  readonly records: readonly ScanRecordForEvidence[];
}): VersionScanEvidence {
  const status = input.safetyStatus;
  if (status === 'QUARANTINED') return { kind: 'HELD', scannedAt: null };
  if (status === 'FAILED') return { kind: 'FAILED', scannedAt: null };

  const virusRecords = input.records.filter((record) =>
    TRUSTED_VIRUS_SCANNER_NAMES.has(record.scannerName),
  );
  const newest = virusRecords.reduce(
    (latest, record) => Math.max(latest, record.scannedAt.getTime()),
    Number.NEGATIVE_INFINITY,
  );
  // Every record at the newest moment must be a pass: a tie never resolves in favour of "scanned".
  const newestRecords = virusRecords.filter((record) => record.scannedAt.getTime() === newest);
  const newestPassed =
    newestRecords.length > 0 && newestRecords.every((record) => record.safe && !record.scanErrored);

  if (status === 'CLEAN') {
    return newestPassed
      ? { kind: 'VIRUS_SCANNED', scannedAt: new Date(newest).toISOString() }
      : { kind: 'FORMAT_CHECKED', scannedAt: null };
  }
  const attemptFailed = newestRecords.some((record) => record.scanErrored);
  if (attemptFailed) return { kind: 'DELAYED', scannedAt: null };
  return { kind: status === 'SCANNING' ? 'CHECKING' : 'WAITING', scannedAt: null };
}

/**
 * The scan evidence of each given version, in one query for the whole list. A version that is not
 * in the result (or a read that fails) is read with `deriveVersionScanEvidence` and no records,
 * which can only ever say FORMAT_CHECKED or a waiting state, never VIRUS_SCANNED: a failure to
 * read the evidence degrades to the cautious wording, never to a claim.
 */
export async function loadVersionScanEvidence(
  db: Db,
  versions: readonly { readonly id: string; readonly safetyStatus: VersionSafetyStatus | null }[],
): Promise<ReadonlyMap<string, VersionScanEvidence>> {
  const result = new Map<string, VersionScanEvidence>();
  if (versions.length === 0) return result;
  const byVersion = new Map<string, ScanRecordForEvidence[]>();
  try {
    const rows = await db
      .select({
        documentVersionId: schema.documentScanResults.documentVersionId,
        scannerName: schema.documentScanResults.scannerName,
        scanErrored: schema.documentScanResults.scanErrored,
        safe: schema.documentScanResults.safe,
        scannedAt: schema.documentScanResults.scannedAt,
      })
      .from(schema.documentScanResults)
      .where(
        inArray(
          schema.documentScanResults.documentVersionId,
          versions.map((version) => version.id),
        ),
      );
    for (const row of rows) {
      const list = byVersion.get(row.documentVersionId) ?? [];
      list.push(row);
      byVersion.set(row.documentVersionId, list);
    }
  } catch {
    byVersion.clear();
  }
  for (const version of versions) {
    result.set(
      version.id,
      deriveVersionScanEvidence({
        safetyStatus: version.safetyStatus,
        records: byVersion.get(version.id) ?? [],
      }),
    );
  }
  return result;
}
