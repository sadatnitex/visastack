import type { Locale } from '@visastack/i18n';
import type {
  AnswerAgencyGroup,
  AnswerCopy,
  AnswerItem,
  AnswerReadiness,
} from '@visastack/services';
import { formatDateOnly } from '../../../../../../lib/format-date';
import { formatMoment } from '../../../../../../lib/save-status';
import { requestName } from '../request-name';

/**
 * What the review screen shows for one agency, as plain already-formatted facts, so the form in the
 * browser formats nothing (no time or date is left for the browser to word, and a server render
 * and a browser render cannot disagree). Pure and free of server code: the page, the form and the
 * measurement fixture share it.
 *
 * Which group a request is in follows the plan's own word for it (`readiness`); nothing here
 * decides what may be sent. The plan already did that, and the send works it out again.
 */

/** Why a copy that may be sent still needs the person to look at it. */
export type AnswerUncertainty =
  | { readonly kind: 'age'; readonly days: number }
  | { readonly kind: 'disagree' };

export interface AnswerCopyView {
  readonly documentId: string;
  readonly versionId: string;
  readonly name: string;
  readonly versionNumber: number;
  /** "27 Oct 2026, 14:32 GMT+6", in the traveller's own time zone. */
  readonly addedLabel: string;
  /** "12 Mar 2031", or null when no expiry date is saved. */
  readonly expiresLabel: string | null;
  /** The document's own date, worded; null when none is saved. */
  readonly documentDateLabel: string | null;
  /** The traveller's own history: this exact copy was accepted before. Never sent to the agency. */
  readonly acceptedBefore: { readonly byAgency: string | null } | null;
  readonly uncertainty: AnswerUncertainty | null;
}

export interface AnswerItemView {
  readonly requestId: string;
  /** "Document: Passport": what is asked. */
  readonly name: string;
  readonly referenceCode: string | null;
  readonly optional: boolean;
  readonly readiness: AnswerReadiness;
  /** The copies the person may send for this request (empty for a request that is not in this step). */
  readonly copies: readonly AnswerCopyView[];
}

export interface AnswerReviewView {
  /** One copy fits and nothing is uncertain: ticked at first. */
  readonly ready: readonly AnswerItemView[];
  /** Several copies fit (the person picks), or one fits with an uncertain date (the person ticks it). */
  readonly choose: readonly AnswerItemView[];
  /** Everything else: one plain line and a link to the request's own page. */
  readonly other: readonly AnswerItemView[];
}

function copyView(
  copy: AnswerCopy,
  item: AnswerItem,
  timeZone: string,
  locale: Locale,
): AnswerCopyView {
  const maxAgeDays = item.rule?.maxAgeDays ?? null;
  return {
    documentId: copy.documentId,
    versionId: copy.versionId,
    name: copy.name,
    versionNumber: copy.versionNumber,
    addedLabel: formatMoment(copy.addedAt, timeZone),
    expiresLabel: copy.expiresOn ? formatDateOnly(copy.expiresOn, locale) : null,
    documentDateLabel: copy.documentDate ? formatDateOnly(copy.documentDate, locale) : null,
    acceptedBefore: copy.acceptedBefore ? { byAgency: copy.acceptedBefore.lastByAgency } : null,
    uncertainty:
      copy.state !== 'DATE_UNCERTAIN'
        ? null
        : maxAgeDays !== null && copy.documentDate === null
          ? { kind: 'age', days: maxAgeDays }
          : { kind: 'disagree' },
  };
}

export function buildAnswerReview(
  group: AnswerAgencyGroup,
  options: { readonly timeZone: string; readonly locale: Locale },
): AnswerReviewView {
  const ready: AnswerItemView[] = [];
  const choose: AnswerItemView[] = [];
  const other: AnswerItemView[] = [];
  for (const item of group.items) {
    const view: AnswerItemView = {
      requestId: item.requestId,
      name: requestName(item),
      referenceCode: item.referenceCode,
      optional: item.rule?.optional ?? false,
      readiness: item.readiness,
      copies:
        item.readiness === 'READY' || item.readiness === 'CHOOSE' || item.readiness === 'CHECK_DATE'
          ? item.copies
              .filter((copy) => copy.sendable)
              .map((copy) => copyView(copy, item, options.timeZone, options.locale))
          : [],
    };
    if (item.readiness === 'READY') ready.push(view);
    else if (item.readiness === 'CHOOSE' || item.readiness === 'CHECK_DATE') choose.push(view);
    else other.push(view);
  }
  return { ready, choose, other };
}

/**
 * A key that changes whenever the plan for this agency changes (the requests, where each stands
 * and the exact versions offered), so a form built from an older plan starts afresh.
 */
export function answerPlanKey(group: AnswerAgencyGroup): string {
  return group.items
    .map(
      (item) =>
        `${item.requestId}:${item.readiness}:${item.copies
          .map((copy) => `${copy.versionId}${copy.sendable ? '' : 'x'}`)
          .join('+')}`,
    )
    .join('|');
}
