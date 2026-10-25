import { CLEAR_PROPOSAL_CONFIDENCE, buildProposedName, extensionOf } from '@visastack/services';
import { documentTypeLabel } from '../../../../lib/labels';
import { recordGroupOfDocType } from './record-groups';

/**
 * The one suggestion a document can be waiting on: what kind of document it is, what to call it,
 * and where it will be listed on the Record (owner request 2026-10-25: "save after approval by the
 * user"). Server only: it reads the catalogue through `record-groups`. Built from data the page
 * already loads, and it carries no document content: only the kind, the suggested name (made from
 * the kind and the person's own name) and the Record group.
 */
export interface DocumentSuggestionView {
  readonly documentId: string;
  /** The waiting name, or null when only a kind is waiting (then `proposedName` is built here). */
  readonly nameVersionId: string | null;
  /** The waiting AI kind, or null when the kind comes from the rules. */
  readonly typeProposalId: string | null;
  /** The suggested kind's catalogue key, or null when nothing could tell. */
  readonly kind: string | null;
  readonly kindLabel: string | null;
  /** Where the Record lists a document of the suggested kind. */
  readonly recordGroup: string | null;
  readonly source: 'ai' | 'rules';
  /** Confident rules, or the person's own kind, read as Clear; an AI kind always reads Please Check. */
  readonly clear: boolean;
  readonly proposedName: string;
  /** What a suggested name puts after the kind (" - Anna Eriksson.pdf"), so Edit can rename for another kind. */
  readonly nameAfterKind: string;
}

export interface DocumentSuggestionInput {
  readonly id: string;
  readonly originalName: string;
  readonly docType: string | null;
  /** The latest file's safety and processing state: nothing is suggested for a file not past its checks. */
  readonly safetyStatus: string | null;
  readonly processingStatus: string | null;
  readonly classification: {
    readonly classifiedType: string | null;
    readonly confidence: number;
    readonly reviewRequired: boolean;
  } | null;
  readonly pendingNameVersion: { readonly id: string; readonly proposedName: string } | null;
}

export interface WaitingKind {
  readonly id: string;
  readonly suggestedType: string;
  /** 0-100. */
  readonly confidence: number;
}

/** File states past the safety scan and the content checks. */
const DECIDABLE_STATES: ReadonlySet<string> = new Set(['AWAITING_REVIEW', 'APPROVED']);

/**
 * The suggestion for one document, or null when nothing is waiting or the latest file is not past
 * its safety checks. A kind the person set always wins: the card never offers to undo it. Then a
 * waiting AI kind for the file's latest version, then the rules' confident classification.
 */
export function documentSuggestionView(
  doc: DocumentSuggestionInput,
  waitingKind: WaitingKind | undefined,
  primarySubject: string,
): DocumentSuggestionView | null {
  if (doc.safetyStatus !== 'CLEAN' || !DECIDABLE_STATES.has(doc.processingStatus ?? '')) {
    return null;
  }
  const nameVersion = doc.pendingNameVersion;
  const aiKind = doc.docType ? undefined : waitingKind;
  if (!nameVersion && !aiKind) return null;

  const rules =
    doc.classification?.classifiedType && !doc.classification.reviewRequired
      ? {
          kind: doc.classification.classifiedType,
          confidence: doc.classification.confidence,
        }
      : undefined;
  const kind = doc.docType ?? aiKind?.suggestedType ?? rules?.kind ?? null;
  const clear =
    doc.docType !== null ||
    (!aiKind && rules !== undefined && rules.confidence >= CLEAR_PROPOSAL_CONFIDENCE);
  const extension = extensionOf(doc.originalName);
  // A name for no kind starts with "Document"; what follows it is the same for every kind.
  const nameAfterKind = buildProposedName({
    classifiedType: null,
    primarySubject,
    extension,
  }).slice('Document'.length);

  return {
    documentId: doc.id,
    nameVersionId: nameVersion?.id ?? null,
    typeProposalId: aiKind?.id ?? null,
    kind,
    kindLabel: kind ? documentTypeLabel(kind) : null,
    recordGroup: kind ? recordGroupOfDocType(kind) : null,
    source: aiKind ? 'ai' : 'rules',
    clear,
    proposedName:
      nameVersion?.proposedName ??
      buildProposedName({ classifiedType: kind, primarySubject, extension }),
    nameAfterKind,
  };
}
