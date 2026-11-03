/**
 * UMPE P3: exception-only review (ledger I07, I11) and the traveller's decision on a proposed
 * relation (ledger I13).
 *
 * One list per person of the files that need a single decision: a file whose kind could not be
 * read, a file read with low confidence, and a proposed relation to another document (an exact
 * duplicate included). A file the reader recognised confidently is routine and never appears here.
 *
 * Deciding a relation is the traveller's own act. Keep Separate only records the answer. Confirm
 * records it and, for a corrected scan or a renewed document, then asks the existing Replace With
 * a Newer Document path to mark the older document as the Earlier Copy (that path keeps both
 * documents, flags any open case using the older one, and keeps every one of its own refusals).
 * Nothing is merged or deleted, ever.
 */

import { type Result, err, ok } from '@visastack/core';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { AuthorizedApplicant } from './access';
import { appendAuditEvent } from './audit';
import { type Db, first, schema } from './db';
import { setDocumentType } from './documents';
import { type ServiceError, serviceError } from './errors';
import { everydayDocumentCondition } from './lifecycle/foundation/conditions';
import { lifecycleTablesPresent } from './lifecycle/foundation/presence';
import { replaceDocument } from './lifecycle/replace/replace';
import { documentKindLabel } from './naming';
import { isIntakeExceptionKind } from './umpe-document-arrival';
import {
  type DocumentRelation,
  isDocumentRelation,
  relationLabels,
} from './umpe-document-relations';
import {
  intakeExceptionsTablePresent,
  relationProposalsTablePresent,
} from './umpe-document-tables';

/** Processing states in which a file has finished its automatic reading. */
const READ_STATES = new Set(['AWAITING_REVIEW', 'APPROVED']);

export type DocumentException =
  | {
      readonly kind: 'relation';
      readonly proposalId: string;
      readonly documentId: string;
      readonly title: string;
      readonly relatedDocumentId: string;
      readonly relatedTitle: string;
      readonly relation: DocumentRelation;
      readonly newIsCurrent: boolean;
      /** Plain labels for the new and the related document. */
      readonly labels: { readonly newDocument: string; readonly relatedDocument: string };
    }
  /** The reader could not tell what this file is. */
  | { readonly kind: 'unknown_type'; readonly documentId: string; readonly title: string }
  /** The reader found some signs of a kind, not enough to suggest it. */
  | { readonly kind: 'low_confidence'; readonly documentId: string; readonly title: string }
  /**
   * UMPE G1 (ledger I07): the rules gave no kind and the background AI reading suggested one. It
   * waits for the person's answer; nothing is saved until they accept it.
   */
  | {
      readonly kind: 'suggested_kind';
      readonly documentId: string;
      readonly title: string;
      readonly suggestedLabel: string;
    }
  /** UMPE G1 (ledger I14): the document had already expired on the day it was added. */
  | {
      readonly kind: 'expired_on_arrival';
      readonly exceptionId: string;
      readonly documentId: string;
      readonly title: string;
    }
  /** UMPE G1 (ledger I14): no readable text could be found in the file. */
  | {
      readonly kind: 'no_readable_text';
      readonly exceptionId: string;
      readonly documentId: string;
      readonly title: string;
    };

export interface ConfirmedRelation {
  readonly documentId: string;
  readonly title: string;
  readonly relatedDocumentId: string;
  readonly relatedTitle: string;
  readonly relation: DocumentRelation;
  readonly labels: { readonly newDocument: string; readonly relatedDocument: string };
}

export interface DocumentExceptionsView {
  /** Files needing one decision, newest first. */
  readonly exceptions: readonly DocumentException[];
  /** Relations the traveller confirmed, for the Current Copy and Earlier Copy labels. */
  readonly confirmed: readonly ConfirmedRelation[];
}

const EMPTY: DocumentExceptionsView = { exceptions: [], confirmed: [] };

type ReadingProof = AuthorizedApplicant<'VIEW_METADATA'>;

/** The traveller's own proof only: the list is the traveller's to-do, never an agency's. */
function isReadingProof(value: unknown): value is ReadingProof {
  return (
    AuthorizedApplicant.isGenuine(value, 'VIEW_METADATA') && value.actor.kind === 'applicant_owner'
  );
}

/** The latest version id of each document. */
async function latestVersionIds(
  db: Db,
  documentIds: readonly string[],
): Promise<Map<string, string>> {
  const latest = new Map<string, { readonly id: string; readonly versionNumber: number }>();
  if (documentIds.length === 0) return new Map();
  const rows = await db
    .select({
      id: schema.documentVersions.id,
      documentId: schema.documentVersions.documentId,
      versionNumber: schema.documentVersions.versionNumber,
    })
    .from(schema.documentVersions)
    .where(inArray(schema.documentVersions.documentId, [...new Set(documentIds)]));
  for (const row of rows) {
    const held = latest.get(row.documentId);
    if (!held || row.versionNumber > held.versionNumber) latest.set(row.documentId, row);
  }
  return new Map(Array.from(latest, ([documentId, row]) => [documentId, row.id] as const));
}

function titleOf(row: { readonly approvedName: string | null }): string {
  return row.approvedName?.trim() || 'Untitled Document';
}

/** The person's files that need one decision, and the relations already confirmed. */
export async function listDocumentExceptions(proof: ReadingProof): Promise<DocumentExceptionsView> {
  if (!isReadingProof(proof)) return EMPTY;
  const db = proof.tx;
  const applicantId = proof.applicant.id;
  const lifecycle = await lifecycleTablesPresent(db);
  const documents = await db
    .select({
      id: schema.documents.id,
      approvedName: schema.documents.approvedName,
      docType: schema.documents.docType,
      createdAt: schema.documents.createdAt,
    })
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.applicantId, applicantId),
        // Archived files are put away on purpose: they ask for no decision.
        lifecycle ? everydayDocumentCondition() : undefined,
      ),
    )
    .orderBy(desc(schema.documents.createdAt));
  if (documents.length === 0) return EMPTY;
  const byId = new Map(documents.map((doc) => [doc.id, doc] as const));

  const exceptions: DocumentException[] = [];
  const confirmed: ConfirmedRelation[] = [];
  const inRelation = new Set<string>();
  if (await relationProposalsTablePresent(db)) {
    const proposals = await db
      .select()
      .from(schema.documentRelationProposals)
      .where(
        and(
          eq(schema.documentRelationProposals.applicantId, applicantId),
          inArray(schema.documentRelationProposals.status, ['PENDING', 'CONFIRMED']),
        ),
      )
      .orderBy(desc(schema.documentRelationProposals.createdAt));
    // A pending suggestion is about one version: once the document has a newer version, the
    // suggestion no longer describes it and is not offered.
    const latestOf = await latestVersionIds(
      db,
      proposals.filter((p) => p.status === 'PENDING').map((p) => p.documentId),
    );
    for (const proposal of proposals) {
      const subject = byId.get(proposal.documentId);
      const related = byId.get(proposal.relatedDocumentId);
      if (!subject || !related || !isDocumentRelation(proposal.relation)) continue;
      if (
        proposal.status === 'PENDING' &&
        latestOf.get(proposal.documentId) !== proposal.documentVersionId
      ) {
        continue;
      }
      const labels = relationLabels(proposal.relation, proposal.newIsCurrent);
      if (proposal.status === 'CONFIRMED') {
        confirmed.push({
          documentId: subject.id,
          title: titleOf(subject),
          relatedDocumentId: related.id,
          relatedTitle: titleOf(related),
          relation: proposal.relation,
          labels,
        });
        continue;
      }
      inRelation.add(subject.id);
      exceptions.push({
        kind: 'relation',
        proposalId: proposal.id,
        documentId: subject.id,
        title: titleOf(subject),
        relatedDocumentId: related.id,
        relatedTitle: titleOf(related),
        relation: proposal.relation,
        newIsCurrent: proposal.newIsCurrent,
        labels,
      });
    }
  }

  // UMPE G1 (ledger I14): findings raised when the latest file of a document was read.
  const unreadable = new Set<string>();
  if (await intakeExceptionsTablePresent(db)) {
    const findings = await db
      .select({
        id: schema.documentIntakeExceptions.id,
        documentId: schema.documentIntakeExceptions.documentId,
        documentVersionId: schema.documentIntakeExceptions.documentVersionId,
        kind: schema.documentIntakeExceptions.kind,
      })
      .from(schema.documentIntakeExceptions)
      .where(
        and(
          eq(schema.documentIntakeExceptions.applicantId, applicantId),
          eq(schema.documentIntakeExceptions.status, 'PENDING'),
        ),
      )
      .orderBy(desc(schema.documentIntakeExceptions.createdAt));
    const current = findings.filter((row) => byId.has(row.documentId));
    const latestOf = await latestVersionIds(
      db,
      current.map((row) => row.documentId),
    );
    // Text read later from the picture (AI reading) answers "no readable text" on its own.
    const unreadableVersionIds = current
      .filter((row) => row.kind === 'NO_READABLE_TEXT')
      .map((row) => row.documentVersionId);
    const readLater = new Set(
      unreadableVersionIds.length > 0
        ? (
            await db
              .select({ documentVersionId: schema.ocrRuns.documentVersionId })
              .from(schema.ocrRuns)
              .where(
                and(
                  inArray(schema.ocrRuns.documentVersionId, unreadableVersionIds),
                  eq(schema.ocrRuns.status, 'SUCCEEDED'),
                ),
              )
          ).map((row) => row.documentVersionId)
        : [],
    );
    for (const row of current) {
      const doc = byId.get(row.documentId);
      if (!doc || !isIntakeExceptionKind(row.kind)) continue;
      if (latestOf.get(row.documentId) !== row.documentVersionId) continue;
      if (row.kind === 'NO_READABLE_TEXT') {
        if (readLater.has(row.documentVersionId)) continue;
        unreadable.add(row.documentId);
      }
      exceptions.push({
        kind: row.kind === 'NO_READABLE_TEXT' ? 'no_readable_text' : 'expired_on_arrival',
        exceptionId: row.id,
        documentId: row.documentId,
        title: titleOf(doc),
      });
    }
  }

  // Files of no known kind: one decision each, once the automatic reading has finished. A file
  // with no readable text is already listed for that, which says more.
  const untyped = documents.filter(
    (doc) => doc.docType === null && !inRelation.has(doc.id) && !unreadable.has(doc.id),
  );
  if (untyped.length > 0) {
    const versions = await db
      .select({
        id: schema.documentVersions.id,
        documentId: schema.documentVersions.documentId,
        versionNumber: schema.documentVersions.versionNumber,
        processingStatus: schema.documentVersions.processingStatus,
      })
      .from(schema.documentVersions)
      .where(
        inArray(
          schema.documentVersions.documentId,
          untyped.map((doc) => doc.id),
        ),
      );
    const latest = new Map<string, (typeof versions)[number]>();
    for (const version of versions) {
      const held = latest.get(version.documentId);
      if (!held || version.versionNumber > held.versionNumber)
        latest.set(version.documentId, version);
    }
    const readVersionIds = Array.from(latest.values())
      .filter((version) => READ_STATES.has(version.processingStatus))
      .map((version) => version.id);
    const classifications =
      readVersionIds.length > 0
        ? await db
            .select({
              documentVersionId: schema.documentClassifications.documentVersionId,
              classifiedType: schema.documentClassifications.classifiedType,
              confidence: schema.documentClassifications.confidence,
              createdAt: schema.documentClassifications.createdAt,
            })
            .from(schema.documentClassifications)
            .where(inArray(schema.documentClassifications.documentVersionId, readVersionIds))
            .orderBy(desc(schema.documentClassifications.createdAt))
        : [];
    const latestClassification = new Map<string, (typeof classifications)[number]>();
    for (const row of classifications) {
      if (!latestClassification.has(row.documentVersionId)) {
        latestClassification.set(row.documentVersionId, row);
      }
    }
    // A kind the AI suggested and the person has not answered yet (one per file, newest first).
    const aiKinds =
      readVersionIds.length > 0
        ? await db
            .select({
              documentVersionId: schema.documentTypeProposals.documentVersionId,
              suggestedType: schema.documentTypeProposals.suggestedType,
            })
            .from(schema.documentTypeProposals)
            .where(
              and(
                inArray(schema.documentTypeProposals.documentVersionId, readVersionIds),
                eq(schema.documentTypeProposals.status, 'PENDING'),
              ),
            )
            .orderBy(desc(schema.documentTypeProposals.createdAt))
        : [];
    const aiKindOf = new Map<string, string>();
    for (const row of aiKinds) {
      if (!aiKindOf.has(row.documentVersionId)) {
        aiKindOf.set(row.documentVersionId, row.suggestedType);
      }
    }
    for (const doc of untyped) {
      const version = latest.get(doc.id);
      if (!version || !READ_STATES.has(version.processingStatus)) continue;
      const reading = latestClassification.get(version.id);
      // A confident reading waits as an ordinary suggestion: routine, not an exception.
      if (reading?.classifiedType) continue;
      const suggested = aiKindOf.get(version.id);
      if (suggested) {
        exceptions.push({
          kind: 'suggested_kind',
          documentId: doc.id,
          title: titleOf(doc),
          suggestedLabel: documentKindLabel(suggested),
        });
        continue;
      }
      exceptions.push(
        reading && reading.confidence > 0
          ? { kind: 'low_confidence', documentId: doc.id, title: titleOf(doc) }
          : { kind: 'unknown_type', documentId: doc.id, title: titleOf(doc) },
      );
    }
  }

  const order = new Map(documents.map((doc, index) => [doc.id, index] as const));
  exceptions.sort((a, b) => (order.get(a.documentId) ?? 0) - (order.get(b.documentId) ?? 0));
  return { exceptions, confirmed };
}

export type RelationDecision = 'CONFIRM' | 'KEEP_SEPARATE';

export function isRelationDecision(value: unknown): value is RelationDecision {
  return value === 'CONFIRM' || value === 'KEEP_SEPARATE';
}

/** Relations whose confirmation makes the older document the Earlier Copy. */
const SUPERSEDING: ReadonlySet<DocumentRelation> = new Set(['CORRECTED_SCAN', 'RENEWED']);

/**
 * The traveller's answer to one proposed relation. Only the traveller's own account decides; a
 * proposal already decided, or one whose documents are gone, answers as not found.
 */
export interface RelationDecisionOutcome {
  readonly status: 'CONFIRMED' | 'DISMISSED';
  /** For a confirmed corrected scan or renewal: the older document is now the Earlier Copy. */
  readonly replaced: boolean;
}

/**
 * The traveller's answer to one proposed relation. Only the traveller's own account decides; a
 * proposal already decided, one about a version that is no longer the latest, or one whose
 * documents are gone, answers as not found.
 *
 * Confirming a corrected scan or a renewal is the traveller saying the new file is the same kind
 * as the older one: when the new file's kind is not saved yet, the older one's kind is saved on
 * it, then Replace With a Newer Document marks the older one. If that path refuses (for example
 * the new file is still being checked), nothing is recorded and the reason comes back as
 * `invalid`, so the suggestion stays and can be answered again later.
 */
export async function decideDocumentRelation(
  proof: AuthorizedApplicant<'MANAGE'>,
  input: { readonly proposalId: string; readonly decision: RelationDecision },
): Promise<Result<RelationDecisionOutcome, ServiceError>> {
  if (!AuthorizedApplicant.isGenuine(proof, 'MANAGE')) {
    return err(serviceError('forbidden', 'not authorized'));
  }
  if (proof.actor.kind !== 'applicant_owner') {
    return err(serviceError('forbidden', 'only the traveller can decide this'));
  }
  if (!isRelationDecision(input.decision)) {
    return err(serviceError('invalid', 'choose Confirm or Keep Separate'));
  }
  const notFound = err(serviceError('not_found', 'suggestion not found'));
  if (!(await relationProposalsTablePresent(proof.tx))) return notFound;
  const db = proof.tx;
  const actorAccountId = proof.applicant.ownerAccountId;
  const applicantId = proof.applicant.id;
  const lifecycle = await lifecycleTablesPresent(db);

  const proposal = first(
    await db
      .select()
      .from(schema.documentRelationProposals)
      .where(
        and(
          eq(schema.documentRelationProposals.id, input.proposalId),
          eq(schema.documentRelationProposals.applicantId, applicantId),
          eq(schema.documentRelationProposals.status, 'PENDING'),
        ),
      )
      .limit(1),
  );
  if (!proposal || !isDocumentRelation(proposal.relation)) return notFound;
  const documents = await db
    .select({ id: schema.documents.id, docType: schema.documents.docType })
    .from(schema.documents)
    .where(
      and(
        inArray(schema.documents.id, [proposal.documentId, proposal.relatedDocumentId]),
        eq(schema.documents.applicantId, applicantId),
        lifecycle ? everydayDocumentCondition() : undefined,
      ),
    );
  if (documents.length !== 2) return notFound;
  const latest = await latestVersionIds(db, [proposal.documentId]);
  if (latest.get(proposal.documentId) !== proposal.documentVersionId) return notFound;

  const status = input.decision === 'CONFIRM' ? ('CONFIRMED' as const) : ('DISMISSED' as const);
  let replaced = false;
  if (status === 'CONFIRMED' && SUPERSEDING.has(proposal.relation)) {
    const [olderId, newerId] = proposal.newIsCurrent
      ? [proposal.relatedDocumentId, proposal.documentId]
      : [proposal.documentId, proposal.relatedDocumentId];
    const older = documents.find((doc) => doc.id === olderId);
    const newer = documents.find((doc) => doc.id === newerId);
    if (newer && older?.docType && newer.docType === null) {
      const typed = await setDocumentType(db, {
        actorAccountId,
        documentId: newer.id,
        docType: older.docType,
      });
      if (!typed.ok) return err(serviceError('invalid', typed.error.message));
    }
    const replacement = await replaceDocument(proof, {
      oldDocumentId: olderId,
      newDocumentId: newerId,
    });
    if (!replacement.ok) return err(serviceError('invalid', replacement.error.message));
    replaced = true;
  }

  const decided = await db.transaction(async (tx: Db) => {
    const updated = await tx
      .update(schema.documentRelationProposals)
      .set({ status, decidedByAccountId: actorAccountId, decidedAt: new Date() })
      .where(
        and(
          eq(schema.documentRelationProposals.id, proposal.id),
          eq(schema.documentRelationProposals.status, 'PENDING'),
        ),
      )
      .returning({ id: schema.documentRelationProposals.id });
    if (updated.length === 0) return false;
    await appendAuditEvent(tx, {
      eventType: 'DOCUMENT_RELATION_DECIDED',
      actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId,
      resourceType: 'document',
      resourceId: proposal.documentId,
      // Kinds only: never a name, a file name or any value read from the document.
      metadata: { relation: proposal.relation, decision: status, replaced },
    });
    return true;
  });
  // Answered at the same moment by another tab: the first answer stands.
  if (!decided && !replaced) return notFound;
  return ok({ status, replaced });
}

/**
 * UMPE G1 (ledger I14): Keep As It Is for one finding raised when a file was read. The traveller's
 * own account only; a finding already answered, or one about another person, answers as not found.
 * Nothing about the document changes.
 */
export async function dismissIntakeException(
  proof: AuthorizedApplicant<'MANAGE'>,
  input: { readonly exceptionId: string },
): Promise<Result<{ readonly kind: string }, ServiceError>> {
  if (!AuthorizedApplicant.isGenuine(proof, 'MANAGE')) {
    return err(serviceError('forbidden', 'not authorized'));
  }
  if (proof.actor.kind !== 'applicant_owner') {
    return err(serviceError('forbidden', 'only the traveller can decide this'));
  }
  const notFound = err(serviceError('not_found', 'finding not found'));
  const db = proof.tx;
  if (!(await intakeExceptionsTablePresent(db))) return notFound;
  const actorAccountId = proof.applicant.ownerAccountId;
  const applicantId = proof.applicant.id;
  return db.transaction(async (tx: Db) => {
    const updated = await tx
      .update(schema.documentIntakeExceptions)
      .set({ status: 'DISMISSED', decidedByAccountId: actorAccountId, decidedAt: new Date() })
      .where(
        and(
          eq(schema.documentIntakeExceptions.id, input.exceptionId),
          eq(schema.documentIntakeExceptions.applicantId, applicantId),
          eq(schema.documentIntakeExceptions.status, 'PENDING'),
        ),
      )
      .returning({
        documentId: schema.documentIntakeExceptions.documentId,
        kind: schema.documentIntakeExceptions.kind,
      });
    const row = updated[0];
    if (!row) return notFound;
    await appendAuditEvent(tx, {
      eventType: 'DOCUMENT_INTAKE_EXCEPTION_DISMISSED',
      actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId,
      resourceType: 'document',
      resourceId: row.documentId,
      // The kind only, never a value read from the document.
      metadata: { kind: row.kind },
    });
    return ok({ kind: row.kind });
  });
}
