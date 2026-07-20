import type { DocumentState } from '@visastack/core';
import { type Result, err, ok } from '@visastack/core';
import { eq } from 'drizzle-orm';
import { appendAuditEvent } from './audit';
import { type Db, first, required, schema } from './db';
import { type ServiceError, serviceError } from './errors';

/**
 * Document intake pipeline (Build Spec §6): quarantine → scan → normalize →
 * extract → awaiting review. Each transition is a small, idempotent,
 * separately-committed step, so a failure leaves a valid resumable state
 * (recoverable) and re-running from any state simply continues. An unsafe scan
 * routes to NEEDS_ATTENTION and never advances to processing.
 */

export interface ScanResult {
  readonly safe: boolean;
  readonly detail?: string;
}

export interface ScannerPort {
  scan(input: {
    readonly bucket: 'QUARANTINE' | 'CLEAN';
    readonly objectKey: string;
  }): Promise<ScanResult>;
}

export type DocumentVersion = typeof schema.documentVersions.$inferSelect;

/** The pure next-state function for the happy path (unsafe scan handled inline). */
export function nextIntakeState(current: DocumentState): DocumentState | null {
  switch (current) {
    case 'UPLOADING':
      return 'QUARANTINED';
    case 'QUARANTINED':
      return 'SCANNING';
    case 'SCANNING':
      return 'NORMALIZING'; // only when safe; caller diverts unsafe scans
    case 'NORMALIZING':
      return 'EXTRACTING';
    case 'EXTRACTING':
      return 'AWAITING_REVIEW';
    default:
      return null; // terminal / manual states
  }
}

async function loadVersion(db: Db, id: string): Promise<DocumentVersion | undefined> {
  return first(
    await db
      .select()
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.id, id))
      .limit(1),
  );
}

async function commitTransition(
  db: Db,
  version: DocumentVersion,
  patch: Partial<{
    processingStatus: DocumentState;
    safetyStatus: DocumentVersion['safetyStatus'];
  }>,
): Promise<DocumentVersion> {
  return db.transaction(async (tx) => {
    const updated = required(
      first(
        await tx
          .update(schema.documentVersions)
          .set({ ...patch, updatedAt: new Date() })
          .where(eq(schema.documentVersions.id, version.id))
          .returning(),
      ),
      'document version',
    );
    await appendAuditEvent(tx, {
      eventType: 'DOCUMENT_STATE_CHANGE',
      method: 'SYSTEM',
      result: 'ALLOWED',
      resourceType: 'document_version',
      resourceId: version.id,
      metadata: {
        from: version.processingStatus,
        to: updated.processingStatus,
        safety: updated.safetyStatus,
      },
    });
    return updated;
  });
}

/**
 * Drive a document version through the intake pipeline to a terminal state
 * (AWAITING_REVIEW on success, NEEDS_ATTENTION on an unsafe scan). Idempotent:
 * calling it on an already-terminal version is a no-op.
 */
export async function processIntake(
  db: Db,
  scanner: ScannerPort,
  input: { readonly documentVersionId: string },
): Promise<Result<DocumentVersion, ServiceError>> {
  let version = await loadVersion(db, input.documentVersionId);
  if (!version) return err(serviceError('not_found', 'document version not found'));

  // Bounded loop: at most one pass through the linear pipeline.
  for (let guard = 0; guard < 8; guard++) {
    const state = version.processingStatus;

    if (state === 'SCANNING') {
      const storageObject = first(
        await db
          .select()
          .from(schema.storageObjects)
          .where(eq(schema.storageObjects.id, version.storageObjectId))
          .limit(1),
      );
      if (!storageObject) return err(serviceError('not_found', 'stored object missing'));
      // If the scanner throws, the version stays in SCANNING and is resumable.
      const result = await scanner.scan({
        bucket: storageObject.bucket,
        objectKey: storageObject.objectKey,
      });
      version = await commitTransition(db, version, {
        processingStatus: result.safe ? 'NORMALIZING' : 'NEEDS_ATTENTION',
        safetyStatus: result.safe ? 'CLEAN' : 'QUARANTINED',
      });
      continue;
    }

    const next = nextIntakeState(state);
    if (next === null) break; // terminal (incl. AWAITING_REVIEW / NEEDS_ATTENTION)
    version = await commitTransition(db, version, {
      processingStatus: next,
      ...(next === 'SCANNING' ? { safetyStatus: 'SCANNING' as const } : {}),
    });
  }

  return ok(version);
}
