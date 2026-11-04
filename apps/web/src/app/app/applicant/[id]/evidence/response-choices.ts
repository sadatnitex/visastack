import type { DocumentSummary, VersionScanEvidence } from '@visastack/services';
import { humanizeCode } from '../../../../../lib/format-code';
import { formatMoment } from '../../../../../lib/save-status';
import { presentScanState } from '../../../../../lib/scan-state';

/**
 * The copies a traveller can send for one document request, worked out on the server and handed to
 * the form as plain, already-worded facts (no stored codes, no times left for the browser to
 * format). Pure and free of server code, so the form, the clearer copy panel and the tests share it.
 *
 * What may be offered: documents of the kind asked for that are still the person's everyday copy
 * (not archived, not removed, not replaced by a newer document). A replaced copy therefore leaves
 * the list, so two identical looking choices are never shown. Each choice names the exact file
 * version that would be sent: the form posts that version, never "whatever is newest later".
 */

/** The id of the visible legend over a request's choices, where focus returns after a clearer copy. */
export function chooseLegendId(requestId: string): string {
  return `choose-${requestId}`;
}

export interface DocumentChoice {
  readonly documentId: string;
  /** The exact version that would be sent. */
  readonly versionId: string;
  readonly name: string;
  readonly kindLabel: string;
  /** "27 Oct 2026, 14:32 GMT+6", in the traveller's own time zone. */
  readonly addedLabel: string;
  /** "Format Checked", "Checked for Viruses" and so on (scan-state.ts). */
  readonly scanLabel: string;
  /** The one plain sentence under the label: why a file cannot be sent yet. */
  readonly scanDetail: string;
  readonly usable: boolean;
  /** This is the copy the agency sent back on this request. */
  readonly sentBack: boolean;
  /** The most recently added of the choices (only marked when there is more than one). */
  readonly newest: boolean;
}

export interface ChoiceInputs {
  readonly documents: readonly DocumentSummary[];
  readonly docType: string | null;
  /** Documents that are still the everyday copy, by lowercase id (CURRENT and not replaced). */
  readonly everyday: ReadonlySet<string>;
  readonly scan: ReadonlyMap<string, VersionScanEvidence>;
  readonly timeZone: string | null;
  /** The document the agency sent back, when the request was sent back. */
  readonly sentBackDocumentId: string | null;
}

/** A file can be sent once it passed its checks and did not fail processing. */
function usableDocument(doc: DocumentSummary): boolean {
  return doc.safetyStatus === 'CLEAN' && doc.processingStatus !== 'FAILED';
}

/** The choices for one document request, newest first. */
export function buildDocumentChoices(input: ChoiceInputs): DocumentChoice[] {
  if (input.docType === null) return [];
  const candidates = input.documents
    .filter(
      (doc) =>
        doc.docType === input.docType &&
        doc.latestVersionId !== null &&
        input.everyday.has(doc.id.toLowerCase()),
    )
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const kindLabel = input.docType ? humanizeCode(input.docType) : 'Document';
  return candidates.map((doc, index) => {
    const versionId = doc.latestVersionId ?? '';
    const scan = presentScanState(input.scan.get(versionId));
    return {
      documentId: doc.id,
      versionId,
      name: doc.approvedName ?? doc.originalName,
      kindLabel,
      addedLabel: formatMoment(doc.createdAt, input.timeZone),
      scanLabel: scan.label,
      scanDetail: scan.detail,
      usable: usableDocument(doc),
      sentBack:
        input.sentBackDocumentId !== null &&
        doc.id.toLowerCase() === input.sentBackDocumentId.toLowerCase(),
      newest: index === 0 && candidates.length > 1,
    };
  });
}

/**
 * The choice to have chosen already: only when exactly one usable copy exists and it is not the
 * one the agency sent back. A person is never handed the rejected copy as a default, and never
 * left to send one silently; the button still has to be pressed.
 */
export function initialChoice(choices: readonly DocumentChoice[]): string {
  const usable = choices.filter((choice) => choice.usable);
  const only = usable.length === 1 ? usable[0] : undefined;
  return only && !only.sentBack ? only.documentId : '';
}

/** The copy the agency sent back, when it is still among the choices: where a clearer copy starts. */
export function clearerCopyTarget(choices: readonly DocumentChoice[]): DocumentChoice | null {
  return choices.find((choice) => choice.sentBack) ?? null;
}
