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
  /** Confident enough to read as Clear; otherwise Please Check. */
  readonly clear: boolean;
  readonly proposedName: string;
  /** The kind the person chose earlier, when the suggestion differs from it. */
  readonly currentKindLabel: string | null;
}

export interface DocumentSuggestionInput {
  readonly id: string;
  readonly originalName: string;
  readonly docType: string | null;
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

/**
 * The suggestion for one document, or null when nothing is waiting. A waiting AI kind for the
 * file's latest version comes first; otherwise the rules' confident classification; otherwise the
 * kind the person already set, so a waiting name always shows where it will be listed.
 */
export function documentSuggestionView(
  doc: DocumentSuggestionInput,
  waitingKind: WaitingKind | undefined,
  primarySubject: string,
): DocumentSuggestionView | null {
  const nameVersion = doc.pendingNameVersion;
  if (!nameVersion && !waitingKind) return null;

  const rules =
    doc.classification?.classifiedType && !doc.classification.reviewRequired
      ? {
          kind: doc.classification.classifiedType,
          confidence: doc.classification.confidence,
        }
      : undefined;
  const kind = waitingKind?.suggestedType ?? rules?.kind ?? doc.docType;
  const confidence = waitingKind?.confidence ?? rules?.confidence ?? 0;

  return {
    documentId: doc.id,
    nameVersionId: nameVersion?.id ?? null,
    typeProposalId: waitingKind?.id ?? null,
    kind,
    kindLabel: kind ? documentTypeLabel(kind) : null,
    recordGroup: kind ? recordGroupOfDocType(kind) : null,
    source: waitingKind ? 'ai' : 'rules',
    clear: kind !== null && (kind === doc.docType || confidence >= CLEAR_PROPOSAL_CONFIDENCE),
    proposedName:
      nameVersion?.proposedName ??
      buildProposedName({
        classifiedType: kind,
        primarySubject,
        extension: extensionOf(doc.originalName),
      }),
    currentKindLabel: doc.docType && doc.docType !== kind ? documentTypeLabel(doc.docType) : null,
  };
}
