import { type Result, err, ok } from '@visastack/core';
import { and, desc, eq } from 'drizzle-orm';
import { AuthorizedApplicant } from './access';
import { appendAuditEvent } from './audit';
import { type Db, first, schema } from './db';
import {
  type ExpiryEntry,
  type ExpiryState,
  describeExpiry,
  expiryDay,
  expiryDayCountsAsExpired,
  expiryDayInRange,
  isTypedMirror,
  latestTypedDay,
  toExpiryEntry,
} from './document-expiry-rules';
import { documentExpiryEntriesTablePresent } from './document-expiry-tables';
import { type ServiceError, serviceError } from './errors';
import { isRealCalendarDay } from './expiry';
import { lifecycleTablesPresent, presentDocumentCondition } from './lifecycle/foundation';
import { incrementMaterialRevision, missionsSelectingDocument } from './material-revision';

/**
 * An expiry date typed by the document's owner (Owner, 10 Nov 2026, "yes P3"). Any document can
 * carry one, not only a passport read from its machine-readable lines. The date is the person's
 * own word: it is never shown as read from the document and never as confirmed by an issuer.
 *
 * Every typed change is a new row in `document_expiry_entries` (nothing is edited or removed, so
 * the history stays). The in-force date, `documents.expires_at`, which the reminders, the lists, the
 * case checks and the readiness rules already read, is changed in the same transaction only when
 * it is empty or already a mirror of a typed date. A date read from a passport is never
 * overwritten, and clearing a typed date never removes a read date: when the two disagree both are
 * kept and the person is asked to check (see document-expiry-rules.ts).
 *
 * The write is one transaction with the document row locked, so two saves cannot interleave. Two
 * other places add rows by the same rules because they set the saved date themselves: the passport
 * reading (intake.ts) and the copy to another person (umpe-document-copies.ts). The audit trail records that a date was entered or cleared and where the in-force date came from,
 * never the date itself.
 */

const NOT_AVAILABLE = 'That document is not available.';
const NOT_SWITCHED_ON = 'Setting an expiry date is not switched on yet. Try again later.';
const BAD_DATE = 'Enter a real date, such as 2031-04-30.';
const OUT_OF_RANGE = 'Enter a date between 1950 and fifty years from now.';

export interface SetDocumentExpiryInput {
  /** `YYYY-MM-DD`, or null to clear the date the person typed. */
  readonly expiresOn: string | null;
  /** The person saw "This date has passed" and chose to save anyway. */
  readonly acknowledgePast?: boolean;
  /** Test clock. */
  readonly now?: Date;
}

export type SetDocumentExpiryOutcome =
  /** The date is in the past and the person has not yet said "Save anyway". Nothing was saved. */
  | { readonly status: 'needs_confirmation' }
  | {
      readonly status: 'saved';
      /** False when the request matched what was already recorded. */
      readonly changed: boolean;
      readonly state: ExpiryState;
      /** The in-force day after the save (a read date wins over a typed one), or null. */
      readonly expiresOn: string | null;
    };

/** The entries of one document, newest first. Call it inside the transaction holding the row lock. */
async function entriesOf(tx: Db, documentId: string): Promise<ExpiryEntry[]> {
  const rows = await tx
    .select({
      source: schema.documentExpiryEntries.source,
      expiresOn: schema.documentExpiryEntries.expiresOn,
      mirrored: schema.documentExpiryEntries.mirrored,
    })
    .from(schema.documentExpiryEntries)
    .where(eq(schema.documentExpiryEntries.documentId, documentId))
    .orderBy(desc(schema.documentExpiryEntries.createdAt), desc(schema.documentExpiryEntries.id));
  return rows.map(toExpiryEntry);
}

/**
 * Type a date for one document, or clear the typed date. The owner only, with the proof made for
 * this document; anyone else, a deleted document and an unknown id all get the same "not
 * available" answer.
 */
export async function setDocumentExpiry(
  proof: AuthorizedApplicant<'MANAGE'>,
  input: SetDocumentExpiryInput,
): Promise<Result<SetDocumentExpiryOutcome, ServiceError>> {
  if (
    !AuthorizedApplicant.isGenuine(proof, 'MANAGE') ||
    proof.actor.kind !== 'applicant_owner' ||
    proof.resource.kind !== 'document'
  ) {
    return err(serviceError('forbidden', NOT_AVAILABLE));
  }
  const now = input.now ?? new Date();
  const day = input.expiresOn;
  if (day !== null) {
    if (!isRealCalendarDay(day)) return err(serviceError('invalid', BAD_DATE));
    if (!expiryDayInRange(day, now)) return err(serviceError('invalid', OUT_OF_RANGE));
  }
  if (!(await documentExpiryEntriesTablePresent(proof.tx))) {
    return err(serviceError('invalid', NOT_SWITCHED_ON));
  }
  const documentId = proof.resource.document.id;
  const actorAccountId = proof.applicant.ownerAccountId;
  const lifecycle = await lifecycleTablesPresent(proof.tx);

  return proof.tx.transaction(async (tx) => {
    // The row lock is what keeps two saves from interleaving between the read and the write.
    const document = first(
      await tx
        .select({
          id: schema.documents.id,
          applicantId: schema.documents.applicantId,
          expiresAt: schema.documents.expiresAt,
        })
        .from(schema.documents)
        .where(
          and(
            eq(schema.documents.id, documentId),
            eq(schema.documents.applicantId, proof.applicant.id),
            // A command on one document: presentDocumentCondition (deleted answers as missing).
            lifecycle ? presentDocumentCondition() : undefined,
          ),
        )
        .limit(1)
        .for('update'),
    );
    if (!document) return err(serviceError('not_found', NOT_AVAILABLE));

    const entries = await entriesOf(tx, documentId);
    const before = describeExpiry(document.expiresAt, entries);
    const typedBefore = latestTypedDay(entries);
    const stateOf = (expiresAt: Date | null, list: readonly ExpiryEntry[]) => {
      const state = describeExpiry(expiresAt, list);
      return {
        status: 'saved' as const,
        state,
        expiresOn: expiresAt ? expiryDay(expiresAt) : null,
      };
    };

    // Nothing to record: the same typed day again (while a date is in force), or clearing when
    // nothing typed is standing. Checked before the question about a passed date, so pressing Save
    // on a date that is already saved never asks again.
    if (day === null ? typedBefore === null : typedBefore === day && before.origin !== 'NONE') {
      return ok({ ...stateOf(document.expiresAt, entries), changed: false });
    }
    // A date that makes the document count as expired asks once, before anything is written.
    if (day !== null && expiryDayCountsAsExpired(day, now) && input.acknowledgePast !== true) {
      return ok({ status: 'needs_confirmation' as const });
    }

    const wasMirror = isTypedMirror(document.expiresAt, entries);
    // The in-force date follows the typed date only while it is empty or already a typed mirror.
    let expiresAt = document.expiresAt;
    let mirrored = false;
    if (day !== null && (before.origin === 'NONE' || wasMirror)) {
      expiresAt = new Date(`${day}T00:00:00.000Z`);
      mirrored = true;
    } else if (day === null && wasMirror) {
      expiresAt = null;
    }
    await tx.insert(schema.documentExpiryEntries).values({
      documentId,
      expiresOn: day,
      source: 'TYPED',
      mirrored,
      enteredByAccountId: actorAccountId,
    });
    const mirrorChanged =
      (expiresAt === null) !== (document.expiresAt === null) ||
      (expiresAt !== null &&
        document.expiresAt !== null &&
        expiresAt.getTime() !== document.expiresAt.getTime());
    if (mirrorChanged) {
      await tx
        .update(schema.documents)
        .set({ expiresAt, updatedAt: now })
        .where(eq(schema.documents.id, documentId));
      // A different date can change whether this document counts as valid evidence.
      for (const missionId of await missionsSelectingDocument(tx, documentId)) {
        await incrementMaterialRevision(tx, missionId);
      }
    }
    const after: ExpiryEntry[] = [{ source: 'TYPED', expiresOn: day, mirrored }, ...entries];
    await appendAuditEvent(tx, {
      eventType: day === null ? 'DOCUMENT_EXPIRY_CLEARED' : 'DOCUMENT_EXPIRY_ENTERED',
      actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId: document.applicantId,
      resourceType: 'document',
      resourceId: documentId,
      // Kinds and flags only, never the date.
      metadata: {
        source: 'TYPED',
        readDateInForce: before.origin === 'READ',
        inForceChanged: mirrorChanged,
        passedAcknowledged: day !== null && expiryDayCountsAsExpired(day, now),
      },
    });
    return ok({ ...stateOf(expiresAt, after), changed: true });
  });
}
