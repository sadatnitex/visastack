import { type Result, err, ok } from '@visastack/core';
import { and, desc, eq } from 'drizzle-orm';
import { AuthorizedApplicant } from './access';
import { appendAuditEvent } from './audit';
import { type Db, first, required, schema } from './db';
import { decideDocumentName, proposeDocumentName } from './document-naming';
import { prepareDocumentKind, setDocumentType } from './documents';
import { type ServiceError, serviceError } from './errors';
import { recordProductEvent } from './product-events';

/**
 * One decision on what a document is and what it is called (owner request 2026-10-25: "save
 * after approval by the user"). Intake and the AI reading only ever leave suggestions: a kind
 * (the rules' classification, or a PENDING `document_type_proposals` row from the AI) and a name
 * (a PENDING `document_name_versions` row). This is the only place the two are saved, together,
 * in one transaction, and only when the document's owner accepts them, edited or not. Skipping
 * changes nothing on the document.
 *
 * Saving goes through the existing decide paths (`setDocumentType`, `decideDocumentName`), so a
 * kind and a name are stored, audited and passed on to the cases using the document exactly as
 * when a person sets them one at a time.
 */

/** The longest name a person can give a document. */
export const MAX_DOCUMENT_NAME_LENGTH = 200;

export type DocumentSuggestionInput =
  | {
      readonly decision: 'accept';
      /** The waiting name this decision answers, or null when only a kind was suggested. */
      readonly nameVersionId: string | null;
      /** The waiting AI kind this decision answers, or null when the kind came from the rules. */
      readonly typeProposalId: string | null;
      /** The kind to save: the suggested one, or another the person chose. */
      readonly docType: string;
      /** What an "Other" kind is. Ignored for every other kind. */
      readonly subject?: string | null;
      /** The name to save: the suggested one, or the person's own. */
      readonly name: string;
    }
  | {
      readonly decision: 'skip';
      readonly nameVersionId: string | null;
      readonly typeProposalId: string | null;
    };

export interface DocumentSuggestionOutcome {
  readonly decision: 'accept' | 'skip';
  /** The document's kind after the decision. */
  readonly docType: string | null;
  /** The document's name after the decision. */
  readonly approvedName: string | null;
}

/** A refusal found inside the transaction: thrown to roll everything back, then returned. */
class Refusal extends Error {
  constructor(readonly serviceError: ServiceError) {
    super(serviceError.message);
  }
}

function refuse(code: ServiceError['code'], message: string): never {
  throw new Refusal(serviceError(code, message));
}

/**
 * A name as a person typed it, made safe to show and to use as a download name: no control
 * characters or path separators, single spaces, at most `MAX_DOCUMENT_NAME_LENGTH` characters.
 */
export function cleanDocumentName(raw: string): string {
  return (
    raw
      .normalize('NFC')
      // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are removed on purpose.
      .replace(/[\x00-\x1f\x7f]/g, '')
      .replace(/[/\\:*?"<>|]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_DOCUMENT_NAME_LENGTH)
      .trim()
  );
}

/**
 * Accept or skip the suggestion for one document. The owner only, through the access gate, with
 * the proof made for this document. Accepting saves the kind and the name together or not at
 * all; a suggestion someone already decided (in another tab, say) is refused rather than
 * decided twice.
 */
export async function decideDocumentSuggestion(
  proof: AuthorizedApplicant<'MANAGE'>,
  input: DocumentSuggestionInput,
): Promise<Result<DocumentSuggestionOutcome, ServiceError>> {
  if (
    !AuthorizedApplicant.isGenuine(proof, 'MANAGE') ||
    proof.actor.kind !== 'applicant_owner' ||
    proof.resource.kind !== 'document'
  ) {
    return err(serviceError('forbidden', 'only the owner can decide what this document is'));
  }
  if (input.nameVersionId === null && input.typeProposalId === null) {
    return err(serviceError('invalid', 'there is no suggestion to decide'));
  }

  let kind: { readonly docType: string | null; readonly subject: string | null } | undefined;
  let name: string | undefined;
  if (input.decision === 'accept') {
    const prepared = prepareDocumentKind(input.docType, input.subject);
    if (!prepared.ok) return prepared;
    if (prepared.value.docType === null) {
      return err(serviceError('invalid', 'choose what kind of document this is'));
    }
    kind = prepared.value;
    name = cleanDocumentName(input.name);
    if (name.length === 0) return err(serviceError('invalid', 'enter a name for this document'));
  }

  const documentId = proof.resource.document.id;
  const actorAccountId = proof.applicant.ownerAccountId;
  try {
    const outcome = await proof.tx.transaction(async (tx) => {
      const document = required(
        first(
          await tx
            .select()
            .from(schema.documents)
            .where(eq(schema.documents.id, documentId))
            .limit(1)
            .for('update'),
        ),
        'document',
      );
      const nameVersion = input.nameVersionId
        ? await lockWaitingName(tx, input.nameVersionId, documentId)
        : undefined;
      const typeProposal = input.typeProposalId
        ? await lockWaitingKind(tx, input.typeProposalId, documentId)
        : undefined;

      if (input.decision === 'skip' || !kind || name === undefined) {
        if (nameVersion) {
          const skipped = await decideDocumentName(tx, {
            actorAccountId,
            nameVersionId: nameVersion.id,
            decision: 'REJECTED',
          });
          if (!skipped.ok) throw new Refusal(skipped.error);
        }
        if (typeProposal) {
          await settleKind(tx, typeProposal, 'REJECTED', actorAccountId);
          await recordProductEvent(tx, {
            eventType: 'AI_PROPOSAL_REJECTED',
            accountId: actorAccountId,
            dimension: 'CLASSIFICATION',
          });
        }
        await appendAuditEvent(tx, {
          eventType: 'DOCUMENT_SUGGESTION_SKIPPED',
          actorAccountId,
          method: 'MANUAL',
          result: 'ALLOWED',
          applicantId: document.applicantId,
          resourceType: 'document',
          resourceId: document.id,
          metadata: {
            nameVersionId: nameVersion?.id ?? null,
            typeProposalId: typeProposal?.id ?? null,
          },
        });
        return {
          decision: 'skip' as const,
          docType: document.docType,
          approvedName: document.approvedName,
        };
      }

      if (kind.docType !== document.docType || kind.subject !== document.subject) {
        const typed = await setDocumentType(tx, {
          actorAccountId,
          documentId,
          docType: kind.docType,
          subject: kind.subject,
        });
        if (!typed.ok) throw new Refusal(typed.error);
      }

      const waitingName =
        nameVersion ??
        (await (async () => {
          // Only a kind was suggested: the person's name is recorded as a suggestion first, so
          // the naming history reads the same as every other decided name.
          const proposed = await proposeDocumentName(tx, {
            documentId,
            proposedName: name,
            reason: 'named by the owner when accepting a suggested kind',
          });
          if (!proposed.ok) throw new Refusal(proposed.error);
          return proposed.value;
        })());
      const nameDecision =
        waitingName.proposedName === name ? 'ACCEPTED_UNCHANGED' : 'ACCEPTED_EDITED';
      const named = await decideDocumentName(tx, {
        actorAccountId,
        nameVersionId: waitingName.id,
        decision: nameDecision,
        finalName: name,
      });
      if (!named.ok) throw new Refusal(named.error);

      const kindAsSuggested = typeProposal ? typeProposal.suggestedType === kind.docType : null;
      if (typeProposal) {
        await settleKind(
          tx,
          typeProposal,
          kindAsSuggested ? 'APPROVED' : 'REJECTED',
          actorAccountId,
        );
        await recordProductEvent(tx, {
          eventType: kindAsSuggested ? 'AI_PROPOSAL_ACCEPTED' : 'AI_PROPOSAL_CORRECTED',
          accountId: actorAccountId,
          dimension: 'CLASSIFICATION',
        });
      }

      await appendAuditEvent(tx, {
        eventType: 'DOCUMENT_SUGGESTION_ACCEPTED',
        actorAccountId,
        method: 'MANUAL',
        result: 'ALLOWED',
        applicantId: document.applicantId,
        resourceType: 'document',
        resourceId: document.id,
        metadata: {
          docType: kind.docType,
          previousDocType: document.docType,
          kindSource: typeProposal ? 'AI' : 'RULES',
          kindAsSuggested,
          nameDecision,
          nameVersionId: waitingName.id,
          typeProposalId: typeProposal?.id ?? null,
        },
      });
      return { decision: 'accept' as const, docType: kind.docType, approvedName: name };
    });
    return ok(outcome);
  } catch (error) {
    if (error instanceof Refusal) return err(error.serviceError);
    throw error;
  }
}

type NameVersionRow = typeof schema.documentNameVersions.$inferSelect;
type TypeProposalRow = typeof schema.documentTypeProposals.$inferSelect;

/** The waiting name, locked for this decision; refused when it belongs to another document or was already decided. */
async function lockWaitingName(
  tx: Db,
  nameVersionId: string,
  documentId: string,
): Promise<NameVersionRow> {
  const row = first(
    await tx
      .select()
      .from(schema.documentNameVersions)
      .where(eq(schema.documentNameVersions.id, nameVersionId))
      .limit(1)
      .for('update'),
  );
  if (!row || row.documentId !== documentId) refuse('not_found', 'suggested name not found');
  if (row.decision !== 'PENDING') refuse('invalid', 'this suggestion has already been decided');
  return row;
}

/** The waiting AI kind, locked for this decision; refused when it is for another document or was already decided. */
async function lockWaitingKind(
  tx: Db,
  proposalId: string,
  documentId: string,
): Promise<TypeProposalRow> {
  const found = first(
    await tx
      .select({
        proposal: schema.documentTypeProposals,
        documentId: schema.documentVersions.documentId,
      })
      .from(schema.documentTypeProposals)
      .innerJoin(
        schema.documentVersions,
        eq(schema.documentVersions.id, schema.documentTypeProposals.documentVersionId),
      )
      .where(eq(schema.documentTypeProposals.id, proposalId))
      .limit(1)
      .for('update', { of: schema.documentTypeProposals }),
  );
  if (!found || found.documentId !== documentId) refuse('not_found', 'suggested kind not found');
  if (found.proposal.status !== 'PENDING') {
    refuse('invalid', 'this suggestion has already been decided');
  }
  return found.proposal;
}

/**
 * Record the person's answer to an AI kind. An approved kind is also written as an AI_APPROVED
 * classification of that file, exactly as `approveDocumentTypeProposal` does, so every later
 * reader sees the same confirmed classification whichever screen it was approved on.
 */
async function settleKind(
  tx: Db,
  proposal: TypeProposalRow,
  status: 'APPROVED' | 'REJECTED',
  actorAccountId: string,
): Promise<void> {
  let classificationId: string | null = null;
  if (status === 'APPROVED') {
    const extraction = first(
      await tx
        .select({ id: schema.extractionRuns.id })
        .from(schema.extractionRuns)
        .where(
          and(
            eq(schema.extractionRuns.documentVersionId, proposal.documentVersionId),
            eq(schema.extractionRuns.status, 'SUCCEEDED'),
          ),
        )
        .orderBy(desc(schema.extractionRuns.createdAt))
        .limit(1),
    );
    if (extraction) {
      const classification = required(
        first(
          await tx
            .insert(schema.documentClassifications)
            .values({
              extractionRunId: extraction.id,
              documentVersionId: proposal.documentVersionId,
              classifiedType: proposal.suggestedType,
              confidence: proposal.confidence,
              reviewRequired: false,
              rationale: proposal.rationale,
              source: 'AI_APPROVED',
            })
            .returning({ id: schema.documentClassifications.id }),
        ),
        'document classification',
      );
      classificationId = classification.id;
    }
  }
  await tx
    .update(schema.documentTypeProposals)
    .set({
      status,
      decidedByAccountId: actorAccountId,
      decidedAt: new Date(),
      ...(classificationId ? { classificationId } : {}),
    })
    .where(eq(schema.documentTypeProposals.id, proposal.id));
}
