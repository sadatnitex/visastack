import { type Result, err, ok } from '@visastack/core';
import { resolveDocumentType } from '@visastack/core/catalogue/documents';
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

/** File states past the safety scan and the content checks: the only ones a suggestion is decided for. */
const DECIDABLE_PROCESSING_STATES: ReadonlySet<string> = new Set(['AWAITING_REVIEW', 'APPROVED']);

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
 * Control characters (C0, DEL and C1) and the bidirectional overrides and isolates that can make
 * a name read differently from what it is ("txt.exe" shown as "exe.txt").
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are removed on purpose.
const UNSAFE_NAME_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g;

/**
 * A name as a person typed it, made safe to show and to use as a download name: no control or
 * text-direction characters, no path separators, single spaces, at most
 * `MAX_DOCUMENT_NAME_LENGTH` characters.
 */
export function cleanDocumentName(raw: string): string {
  return raw
    .normalize('NFC')
    .replace(UNSAFE_NAME_CHARACTERS, '')
    .replace(/[/\\:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_DOCUMENT_NAME_LENGTH)
    .trim();
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
      // Nothing is decided for a file that is not, or is no longer, past its safety checks.
      const latest = first(
        await tx
          .select({
            id: schema.documentVersions.id,
            safetyStatus: schema.documentVersions.safetyStatus,
            processingStatus: schema.documentVersions.processingStatus,
          })
          .from(schema.documentVersions)
          .where(eq(schema.documentVersions.documentId, documentId))
          .orderBy(desc(schema.documentVersions.versionNumber))
          .limit(1),
      );
      if (
        !latest ||
        latest.safetyStatus !== 'CLEAN' ||
        !DECIDABLE_PROCESSING_STATES.has(latest.processingStatus)
      ) {
        refuse('invalid', 'this file has not finished its safety checks');
      }
      const nameVersion = input.nameVersionId
        ? await lockWaitingName(tx, input.nameVersionId, documentId)
        : undefined;
      const typeProposal = input.typeProposalId
        ? await lockWaitingKind(tx, input.typeProposalId, latest.id)
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

      // The AI kind is answered first, then the kind saved: saving a kind closes any AI kind still
      // waiting, and this one is already answered by then. Kinds compare by their standard
      // catalogue key, so choosing an alias of the suggestion is not recorded as a correction.
      const kindAsSuggested = typeProposal
        ? (resolveDocumentType(typeProposal.suggestedType)?.key ?? typeProposal.suggestedType) ===
          kind.docType
        : null;
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

/**
 * The waiting AI kind, locked for this decision; refused unless it was made for the document's
 * current file (never another document's, never an older file's) and is still waiting.
 */
async function lockWaitingKind(
  tx: Db,
  proposalId: string,
  latestVersionId: string,
): Promise<TypeProposalRow> {
  const found = first(
    await tx
      .select()
      .from(schema.documentTypeProposals)
      .where(eq(schema.documentTypeProposals.id, proposalId))
      .limit(1)
      .for('update'),
  );
  if (!found || found.documentVersionId !== latestVersionId) {
    refuse('not_found', 'suggested kind not found');
  }
  if (found.status !== 'PENDING') refuse('invalid', 'this suggestion has already been decided');
  return found;
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
