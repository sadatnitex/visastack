import type { Locale } from '@visastack/i18n';
import type { DocumentSummary, VersionScanEvidence } from '@visastack/services';
import { humanizeCode } from '../../../../../lib/format-code';
import { formatDateOnly } from '../../../../../lib/format-date';
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
  /** "Expires 12 Mar 2031" or "Expired on 12 Mar 2025"; null when no expiry date is saved. */
  readonly dateNote?: string | null;
  /** The expiry day is today or earlier (UTC): the note is shown in the warning tone. */
  readonly expired?: boolean;
  /** The saved expiry dates disagree (one read from the file, one typed): the date is not certain. */
  readonly uncertainDate?: boolean;
  /** One plain sentence saying the dates disagree; only with `uncertainDate`. */
  readonly uncertainNote?: string;
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
  /**
   * The exact version the agency sent back, when the history pins one. A newer version of the same
   * document is then a different copy, not the one sent back; without it every version of the
   * document counts as sent back.
   */
  readonly sentBackVersionId?: string | null;
  /** The page's language, for the date inside the note; English when left out. */
  readonly locale?: Locale;
  /** The words of the date note, from the catalogue. Without them there is no note. */
  readonly words?: {
    readonly expires: (date: string) => string;
    readonly expired: (date: string) => string;
    /** The sentence for a copy whose saved dates disagree. */
    readonly uncertain?: string;
  };
}

/** A file can be sent once it passed its checks and did not fail processing. */
function usableDocument(doc: DocumentSummary): boolean {
  return doc.safetyStatus === 'CLEAN' && doc.processingStatus !== 'FAILED';
}

/**
 * Whether an expiry day (`YYYY-MM-DD`) counts as expired on `now`: the day is today or earlier in
 * UTC. The same rule as `expiryDayCountsAsExpired` in the services package, which the web package
 * does not export; the two strings compare in calendar order, so a plain comparison is enough.
 */
export function expiryDayIsExpired(day: string, now: Date = new Date()): boolean {
  return day <= now.toISOString().slice(0, 10);
}

/** The expiry note for one copy, and whether it is the warning kind. Nothing when no expiry is saved. */
function dateNoteFor(
  expiresAt: string | null | undefined,
  words: ChoiceInputs['words'],
  locale: Locale,
  now: Date,
): { readonly dateNote: string | null; readonly expired: boolean } {
  // A date that cannot be read is treated as no date, never as a reason to fail the page.
  if (!expiresAt || Number.isNaN(Date.parse(expiresAt))) return { dateNote: null, expired: false };
  const day = new Date(expiresAt).toISOString().slice(0, 10);
  const expired = expiryDayIsExpired(day, now);
  if (!words) return { dateNote: null, expired };
  const date = formatDateOnly(expiresAt, locale);
  return { dateNote: expired ? words.expired(date) : words.expires(date), expired };
}

/** The choices for one document request, newest first. */
export function buildDocumentChoices(
  input: ChoiceInputs,
  now: Date = new Date(),
): DocumentChoice[] {
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
        doc.id.toLowerCase() === input.sentBackDocumentId.toLowerCase() &&
        (input.sentBackVersionId == null ||
          versionId.toLowerCase() === input.sentBackVersionId.toLowerCase()),
      ...(doc.expiry?.mismatch === true
        ? {
            uncertainDate: true,
            ...(input.words?.uncertain ? { uncertainNote: input.words.uncertain } : {}),
          }
        : {}),
      newest: index === 0 && candidates.length > 1,
      ...dateNoteFor(doc.expiresAt, input.words, input.locale ?? 'en', now),
    };
  });
}

/**
 * The choice to have chosen already: only when exactly one usable copy exists and it is a copy the
 * person can rely on: not the one the agency sent back, not out of date and not of an uncertain
 * date. A person is never handed outdated or rejected evidence as a default, and never left to send
 * one silently; the button still has to be pressed, and an older copy stays there to choose on
 * purpose.
 */
export function initialChoice(choices: readonly DocumentChoice[]): string {
  const usable = choices.filter((choice) => choice.usable);
  const only = usable.length === 1 ? usable[0] : undefined;
  return only && !only.sentBack && !only.expired && !only.uncertainDate ? only.documentId : '';
}

/** A copy that can be sent and is neither sent back, out of date nor of an uncertain date. */
export function isCurrentCopy(choice: DocumentChoice): boolean {
  return choice.usable && !choice.sentBack && !choice.expired && !choice.uncertainDate;
}

/** The copy the agency sent back, which the clearer copy replaces. */
export function clearerCopyTarget(choices: readonly DocumentChoice[]): DocumentChoice | null {
  return choices.find((choice) => choice.sentBack) ?? null;
}
