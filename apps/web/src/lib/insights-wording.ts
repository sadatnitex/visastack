import type {
  CaseReadinessState,
  ExpiryUrgency,
  InsightDocumentRef,
  OriginalsItem,
} from '@visastack/services';
import type { Tone } from '../components/ui';
import { humanizeFieldKey } from './field-key-label';
import { documentTypeLabel } from './labels';
import { fieldLabel } from './master-profile';

/**
 * Plain words for the Document Insights page. Server-side only (it reads the catalogue through
 * master-profile). Every name here is built from a document kind, a detail's name or a count,
 * never from a value, so nothing sensitive can reach the page through these helpers.
 */

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** "Passport", or "Passport 2 of 3" when there is more than one; a kind not known yet reads plainly. */
export function documentName(ref: InsightDocumentRef): string {
  const kind = ref.kind ? documentTypeLabel(ref.kind) : 'Document Not Yet Sorted';
  return ref.ofKind > 1 ? `${kind} ${ref.ordinal} of ${ref.ofKind}` : kind;
}

/** The plain name of a profile detail. */
export function detailName(fieldKey: string): string {
  return fieldLabel(fieldKey) ?? humanizeFieldKey(fieldKey);
}

const DAYS_PER_MONTH = 30.44;

/**
 * How long until (or since) a document's expiry, in the words a person would use. `expired` is
 * the timeline's own verdict: a document whose time ran out earlier today reads "Expired today".
 */
export function timeUntilExpiry(daysRemaining: number, expired = daysRemaining < 0): string {
  if (daysRemaining === 0) return expired ? 'Expired today' : 'Expires today';
  if (daysRemaining === 1) return 'Expires tomorrow';
  if (daysRemaining === -1) return 'Expired yesterday';
  const days = Math.abs(daysRemaining);
  let span: string;
  if (days <= 60) {
    span = plural(days, 'day');
  } else if (days < 730) {
    span = `about ${plural(Math.round(days / DAYS_PER_MONTH), 'month')}`;
  } else {
    span = `about ${plural(Math.round(days / 365.25), 'year')}`;
  }
  return daysRemaining > 0 ? `Expires in ${span}` : `Expired ${span} ago`;
}

/** The same badges the Expiry page uses. */
export const EXPIRY_BADGE: Readonly<Record<ExpiryUrgency, { label: string; tone: Tone }>> = {
  unknown: { label: 'Unknown', tone: 'neutral' },
  ok: { label: 'OK', tone: 'success' },
  reminder: { label: 'Expiring Soon', tone: 'warning' },
  expired: { label: 'Expired', tone: 'danger' },
};

/** The same readiness names the case page shows, plus one for a case with no checklist yet. */
export const READINESS_BADGE: Readonly<Record<CaseReadinessState, { label: string; tone: Tone }>> =
  {
    READY_FOR_APPLICANT_REVIEW: { label: 'Ready for Review', tone: 'success' },
    NEEDS_REVIEW: { label: 'Needs Review', tone: 'warning' },
    NEEDS_ACTION: { label: 'Needs Action', tone: 'danger' },
    MANUAL_ONLY: { label: 'Manual · Not Automatically Assessed', tone: 'neutral' },
    NO_CHECKLIST: { label: 'No Checklist Yet', tone: 'neutral' },
    UNAVAILABLE: { label: 'Not Available Right Now', tone: 'neutral' },
  };

/** The same names the case page gives each requirement, so the two pages always agree. */
export const ORIGINAL_STATE_BADGE: Readonly<
  Record<OriginalsItem['state'], { label: string; tone: Tone }>
> = {
  CRITICAL_GAP: { label: 'Missing', tone: 'danger' },
  CONFLICTING: { label: 'Two Values', tone: 'danger' },
  EXPIRING_STALE: { label: 'Out of Date', tone: 'danger' },
  UNVERIFIED: { label: 'To Confirm', tone: 'warning' },
  ATTENTION: { label: 'Optional', tone: 'neutral' },
  SATISFIED: { label: 'On File', tone: 'success' },
};

/** "1 of 4 required items ready", or a next step when there is nothing to count. */
export function readinessLine(
  state: CaseReadinessState,
  satisfied: number,
  required: number,
): string {
  if (state === 'NO_CHECKLIST') return 'Choose a visa route on this case to see what it needs.';
  if (state === 'UNAVAILABLE')
    return 'Readiness could not be loaded just now. Open the case to see it.';
  if (state === 'MANUAL_ONLY') return 'This case is checked by hand, not automatically.';
  if (required === 0) return 'This route lists nothing as required yet.';
  return `${satisfied} of ${plural(required, 'required item')} ready`;
}

export { plural };
