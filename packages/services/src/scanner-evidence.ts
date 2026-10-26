import { and, desc, eq, gte } from 'drizzle-orm';
import { appendAuditEvent } from './audit';
import { type Db, first, schema } from './db';

/**
 * Evidence that the private virus scanner is really running (S4, M06). The scanner lives in a
 * GitHub worker, so the website cannot ping it. Each worker run first proves the live engine
 * (a harmless file passes, a standard test file is caught, signatures are fresh) and then
 * records one audit row of this kind. Readiness reports the scanner as available only while the
 * newest such row is recent, so a worker that stops running stops being counted. The audit
 * trail is append-only and hash-chained, so the evidence cannot be edited afterwards, and the
 * row holds only the engine name and version, never a file or a person.
 */

export const SCANNER_VERIFIED_EVENT = 'SCANNER_ENGINE_VERIFIED';

/** The worker runs at least daily; three days leaves room for a missed run, not for a dead worker. */
export const SCANNER_EVIDENCE_MAX_AGE_MS = 72 * 60 * 60 * 1000;

export async function recordScannerEngineVerified(
  db: Db,
  input: { readonly engine: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    await appendAuditEvent(tx, {
      eventType: SCANNER_VERIFIED_EVENT,
      method: 'SYSTEM',
      result: 'ALLOWED',
      resourceType: 'malware_scanner',
      // Printable engine text only, bounded: a version line, never anything from a file.
      reason: input.engine.replace(/[^\x20-\x7e]/g, '').slice(0, 120),
    });
  });
}

export interface ScannerEvidence {
  readonly verifiedAt: Date;
  readonly engine: string;
}

/** The newest recent verification, or null when there is none or it cannot be read. */
export async function loadScannerEvidence(
  db: Db,
  now: Date = new Date(),
): Promise<ScannerEvidence | null> {
  try {
    const row = first(
      await db
        .select({
          occurredAt: schema.auditEvents.occurredAt,
          reason: schema.auditEvents.reason,
        })
        .from(schema.auditEvents)
        .where(
          and(
            eq(schema.auditEvents.eventType, SCANNER_VERIFIED_EVENT),
            gte(
              schema.auditEvents.occurredAt,
              new Date(now.getTime() - SCANNER_EVIDENCE_MAX_AGE_MS),
            ),
          ),
        )
        .orderBy(desc(schema.auditEvents.seq))
        .limit(1),
    );
    return row ? { verifiedAt: row.occurredAt, engine: row.reason ?? '' } : null;
  } catch {
    return null;
  }
}
