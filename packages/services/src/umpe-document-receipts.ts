/**
 * UMPE P3: server upload idempotency (ledger I16).
 *
 * The browser mints one upload id per file and sends it on every attempt. Before any quota is
 * reserved the upload claims that id here. A repeat of an upload that already produced a document
 * gets that same document back (nothing stored twice, no quota spent); a repeat that arrives while
 * the first is still being stored is told to wait; an upload that failed releases its claim so the
 * same id can be tried again. A claim left behind by a crashed request is checked against the
 * stored object first: if the document was in fact registered, the claim is completed with it and
 * replayed; only otherwise is it taken over.
 *
 * Every function takes the access gate's proof for the traveller (MANAGE) and acts for that
 * traveller's own account only. Until the migration runs, every function reports `untracked` or
 * does nothing, so an upload behaves exactly as before.
 */

import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { AuthorizedApplicant } from './access';
import { type Db, first, schema } from './db';
import { presentDocumentCondition } from './lifecycle/foundation/conditions';
import { lifecycleTablesPresent } from './lifecycle/foundation/presence';
import { sanitizeOriginalFileName } from './umpe-document-names';
import { uploadReceiptsTablePresent } from './umpe-document-tables';

/** How long a completed upload id answers with its original document. */
export const UPLOAD_REPLAY_WINDOW_MS = 24 * 60 * 60 * 1000;
/**
 * How long a claim may stay in progress before another request with the same id may check it and
 * take it over. Well past the route's own 60-second limit and the browser's 5-minute timeout.
 */
export const UPLOAD_CLAIM_STALE_MS = 10 * 60 * 1000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether a value is usable as an upload id (any UUID shape, lower or upper case). */
export function isUploadId(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

export type UploadReceiptClaim =
  /** The tables are not there yet, or no upload id was sent: upload as before. */
  | { readonly kind: 'untracked' }
  /** This request owns the upload id now and must complete or release it. */
  | { readonly kind: 'claimed'; readonly receiptId: string; readonly claimToken: string }
  /** The same upload already produced this document: answer with it, store nothing. */
  | {
      readonly kind: 'replay';
      readonly documentId: string;
      readonly documentVersionId: string;
      readonly title: string | null;
    }
  /** Another request with the same id is storing it right now: answer busy, try again soon. */
  | { readonly kind: 'in_progress' }
  /** The id was already used for a different traveller: refuse, never cross people. */
  | { readonly kind: 'conflict' };

export interface ClaimUploadReceiptInput {
  readonly uploadId: string | null;
  /** The file's own name as the device gave it; cleaned before it is kept. */
  readonly originalFileName?: string | null;
  /** The current time; a test passes a fixed one. */
  readonly now?: Date;
}

type Receipt = typeof schema.documentUploadReceipts.$inferSelect;

function ownerOf(proof: AuthorizedApplicant<'MANAGE'>): string | null {
  return proof.actor.kind === 'applicant_owner' ? proof.applicant.ownerAccountId : null;
}

/** The document a receipt points at, when it is still present (not deleted). */
async function presentDocument(
  tx: Db,
  documentId: string,
  applicantId: string,
): Promise<{ readonly id: string; readonly approvedName: string | null } | null> {
  const lifecycle = await lifecycleTablesPresent(tx);
  return (
    first(
      await tx
        .select({ id: schema.documents.id, approvedName: schema.documents.approvedName })
        .from(schema.documents)
        .where(
          and(
            eq(schema.documents.id, documentId),
            eq(schema.documents.applicantId, applicantId),
            lifecycle ? presentDocumentCondition() : undefined,
          ),
        )
        .limit(1),
    ) ?? null
  );
}

/** The version a crashed request stored under its reserved object key, if it got that far. */
async function versionStoredFor(
  tx: Db,
  intentId: string,
): Promise<{ readonly documentId: string; readonly versionId: string } | null> {
  const row = first(
    await tx
      .select({
        documentId: schema.documentVersions.documentId,
        versionId: schema.documentVersions.id,
      })
      .from(schema.uploadIntents)
      .innerJoin(
        schema.storageObjects,
        eq(schema.storageObjects.objectKey, schema.uploadIntents.objectKey),
      )
      .innerJoin(
        schema.documentVersions,
        eq(schema.documentVersions.storageObjectId, schema.storageObjects.id),
      )
      .where(eq(schema.uploadIntents.id, intentId))
      .limit(1),
  );
  return row ?? null;
}

async function takeOver(
  tx: Db,
  receipt: Receipt,
  originalFileName: string | null,
  now: Date,
): Promise<UploadReceiptClaim> {
  const claimToken = randomUUID();
  await tx
    .update(schema.documentUploadReceipts)
    .set({
      claimToken,
      status: 'PENDING',
      claimedAt: now,
      completedAt: null,
      uploadIntentId: null,
      documentId: null,
      documentVersionId: null,
      originalFileName,
    })
    .where(eq(schema.documentUploadReceipts.id, receipt.id));
  return { kind: 'claimed', receiptId: receipt.id, claimToken };
}

/**
 * Claims an upload id for this traveller's owner before anything is reserved or stored. See
 * `UploadReceiptClaim` for each answer.
 */
export async function claimUploadReceipt(
  proof: AuthorizedApplicant<'MANAGE'>,
  input: ClaimUploadReceiptInput,
): Promise<UploadReceiptClaim> {
  if (!AuthorizedApplicant.isGenuine(proof, 'MANAGE')) return { kind: 'conflict' };
  const accountId = ownerOf(proof);
  if (!accountId || !isUploadId(input.uploadId)) return { kind: 'untracked' };
  if (!(await uploadReceiptsTablePresent(proof.tx))) return { kind: 'untracked' };
  const uploadId = input.uploadId.toLowerCase();
  const applicantId = proof.applicant.id;
  const now = input.now ?? new Date();
  const originalFileName = sanitizeOriginalFileName(input.originalFileName);

  return proof.tx.transaction(async (tx) => {
    const claimToken = randomUUID();
    const inserted = first(
      await tx
        .insert(schema.documentUploadReceipts)
        .values({ accountId, applicantId, uploadId, claimToken, originalFileName, claimedAt: now })
        .onConflictDoNothing({
          target: [schema.documentUploadReceipts.accountId, schema.documentUploadReceipts.uploadId],
        })
        .returning({ id: schema.documentUploadReceipts.id }),
    );
    if (inserted) return { kind: 'claimed', receiptId: inserted.id, claimToken };

    const receipt = first(
      await tx
        .select()
        .from(schema.documentUploadReceipts)
        .where(
          and(
            eq(schema.documentUploadReceipts.accountId, accountId),
            eq(schema.documentUploadReceipts.uploadId, uploadId),
          ),
        )
        .limit(1)
        .for('update'),
    );
    // Deleted between the insert and this read (a release): one more claim attempt is enough.
    if (!receipt) {
      const retried = first(
        await tx
          .insert(schema.documentUploadReceipts)
          .values({
            accountId,
            applicantId,
            uploadId,
            claimToken,
            originalFileName,
            claimedAt: now,
          })
          .onConflictDoNothing({
            target: [
              schema.documentUploadReceipts.accountId,
              schema.documentUploadReceipts.uploadId,
            ],
          })
          .returning({ id: schema.documentUploadReceipts.id }),
      );
      return retried
        ? { kind: 'claimed', receiptId: retried.id, claimToken }
        : { kind: 'in_progress' };
    }
    if (receipt.applicantId !== applicantId) return { kind: 'conflict' };

    if (receipt.status === 'COMPLETED') {
      const fresh =
        receipt.completedAt !== null &&
        now.getTime() - receipt.completedAt.getTime() < UPLOAD_REPLAY_WINDOW_MS;
      const document =
        fresh && receipt.documentId && receipt.documentVersionId
          ? await presentDocument(tx, receipt.documentId, applicantId)
          : null;
      if (document && receipt.documentVersionId) {
        return {
          kind: 'replay',
          documentId: document.id,
          documentVersionId: receipt.documentVersionId,
          title: document.approvedName,
        };
      }
      // Older than the window, or the document has since been removed: this is a new upload.
      return takeOver(tx, receipt, originalFileName, now);
    }

    if (now.getTime() - receipt.claimedAt.getTime() < UPLOAD_CLAIM_STALE_MS) {
      return { kind: 'in_progress' };
    }
    // A claim left by a request that never finished. If it registered the document before it
    // stopped, finish the receipt with that document and answer with it: never a second copy.
    const stored = receipt.uploadIntentId
      ? await versionStoredFor(tx, receipt.uploadIntentId)
      : null;
    if (stored) {
      const document = await presentDocument(tx, stored.documentId, applicantId);
      await tx
        .update(schema.documentUploadReceipts)
        .set({
          status: 'COMPLETED',
          documentId: stored.documentId,
          documentVersionId: stored.versionId,
          completedAt: now,
        })
        .where(eq(schema.documentUploadReceipts.id, receipt.id));
      if (document) {
        return {
          kind: 'replay',
          documentId: document.id,
          documentVersionId: stored.versionId,
          title: document.approvedName,
        };
      }
    }
    return takeOver(tx, receipt, originalFileName, now);
  });
}

interface HeldClaim {
  readonly receiptId: string;
  readonly claimToken: string;
}

function heldBy(proof: AuthorizedApplicant<'MANAGE'>, claim: HeldClaim) {
  return and(
    eq(schema.documentUploadReceipts.id, claim.receiptId),
    eq(schema.documentUploadReceipts.claimToken, claim.claimToken),
    eq(schema.documentUploadReceipts.applicantId, proof.applicant.id),
    eq(schema.documentUploadReceipts.status, 'PENDING'),
  );
}

/** Records which reservation this claim is storing under, so a crash can be checked later. */
export async function attachUploadIntent(
  proof: AuthorizedApplicant<'MANAGE'>,
  claim: HeldClaim & { readonly uploadIntentId: string },
): Promise<void> {
  if (!AuthorizedApplicant.isGenuine(proof, 'MANAGE')) return;
  await proof.tx
    .update(schema.documentUploadReceipts)
    .set({ uploadIntentId: claim.uploadIntentId })
    .where(heldBy(proof, claim));
}

/** Finishes a claim with the document it produced. True when this request still held it. */
export async function completeUploadReceipt(
  proof: AuthorizedApplicant<'MANAGE'>,
  claim: HeldClaim & {
    readonly documentId: string;
    readonly documentVersionId: string;
    readonly now?: Date;
  },
): Promise<boolean> {
  if (!AuthorizedApplicant.isGenuine(proof, 'MANAGE')) return false;
  const updated = await proof.tx
    .update(schema.documentUploadReceipts)
    .set({
      status: 'COMPLETED',
      documentId: claim.documentId,
      documentVersionId: claim.documentVersionId,
      completedAt: claim.now ?? sql`now()`,
    })
    .where(heldBy(proof, claim))
    .returning({ id: schema.documentUploadReceipts.id });
  return updated.length > 0;
}

/** Lets go of a claim whose upload stored nothing, so the same id can be tried again. */
export async function releaseUploadReceipt(
  proof: AuthorizedApplicant<'MANAGE'>,
  claim: HeldClaim,
): Promise<void> {
  if (!AuthorizedApplicant.isGenuine(proof, 'MANAGE')) return;
  await proof.tx.delete(schema.documentUploadReceipts).where(heldBy(proof, claim));
}
