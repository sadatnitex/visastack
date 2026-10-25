import { CATALOGUE_MODULES, MODULE_FIELDS } from '@visastack/core/catalogue';
import type {
  CaseDetailField,
  ConsistencyResult,
  MemoryChange,
  MemoryEvent,
} from '@visastack/services';
import { humanizeFieldKey } from './field-key-label';
import { formatTimestampDate } from './format-date';
import { documentTypeLabel } from './labels';
import { fieldLabel } from './master-profile';

/**
 * Plain wording for Application Memory and the then-and-now view (WP-V3
 * part 3). Pure functions with no page or service calls, so the wording is
 * tested on its own and shared by the case alert and the memory pages.
 *
 * Truth rules kept here (PROGRAMME section 8): prepared, confirmed and
 * reported as submitted are three different things; a note is a statement,
 * not proof; nothing names a value.
 */

export const CASE_FIELD_LABELS: Readonly<Record<CaseDetailField, string>> = {
  requirementPack: 'Requirement list',
  manualMode: 'Manual assessment',
  jurisdiction: 'Where you apply',
  serviceCategory: 'Type of service',
  travelStartDate: 'Travel start date',
  travelEndDate: 'Travel end date',
  targetDeadline: 'Target date',
};

export function detailName(fieldKey: string): string {
  return fieldLabel(fieldKey) ?? humanizeFieldKey(fieldKey);
}

function documentName(docType: string | null): string {
  return docType ? documentTypeLabel(docType) : 'Document without a kind';
}

/** One changed item as a name and a short lower-case description, never a value. */
export function changeLine(change: MemoryChange): { readonly name: string; readonly what: string } {
  switch (change.kind) {
    case 'detail':
      return {
        name: detailName(change.fieldKey),
        what:
          change.change === 'changed'
            ? 'changed'
            : change.change === 'removed'
              ? 'removed'
              : change.change === 'not_used'
                ? 'no longer used in this case'
                : 'added to this case',
      };
    case 'document':
      return {
        name: documentName(change.docType),
        what:
          change.change === 'new_version'
            ? 'new version added'
            : change.change === 'replaced'
              ? 'replaced by another document'
              : change.change === 'removed'
                ? 'no longer available'
                : change.change === 'not_used'
                  ? 'no longer used in this case'
                  : 'added to this case',
      };
    case 'case':
      return { name: CASE_FIELD_LABELS[change.caseField], what: 'changed' };
  }
}

/** A detail that changed and has both versions can be compared side by side. */
export function comparableVersionId(change: MemoryChange): string | null {
  return change.kind === 'detail' &&
    change.priorFactVersionId !== null &&
    change.currentFactVersionId !== null
    ? change.priorFactVersionId
    : null;
}

const SHOWN_MODULES: ReadonlySet<string> = new Set(
  CATALOGUE_MODULES.filter((module) => !module.internal).map((module) => module.key),
);
const MODULE_BY_FIELD: ReadonlyMap<string, string> = new Map(
  MODULE_FIELDS.filter((field) => SHOWN_MODULES.has(field.module)).map(
    (field) => [field.key, field.module] as const,
  ),
);

/** The profile, opened at the section that holds this detail when there is one. */
export function profileSectionHref(applicantId: string, fieldKey: string): string {
  const section = MODULE_BY_FIELD.get(fieldKey);
  return `/app/applicant/${applicantId}/profile#${section ? `section-${section}` : 'profile-editor'}`;
}

export function memoryHref(applicantId: string): string {
  return `/app/applicant/${applicantId}/memory`;
}

export function compareHref(
  applicantId: string,
  snapshotId: string,
  factVersionId?: string,
): string {
  const query = new URLSearchParams({ snapshot: snapshotId });
  if (factVersionId) query.set('version', factVersionId);
  return `/app/applicant/${applicantId}/memory/compare?${query.toString()}`;
}

const SUBMISSION_CHANNEL_LABELS: Readonly<Record<string, string>> = {
  EMBASSY_PORTAL: 'embassy or consulate portal',
  EMAIL: 'email',
  IN_PERSON: 'in person',
  COURIER: 'courier',
  VISA_APPLICATION_CENTER: 'visa application centre',
  OTHER: 'another way',
};

const OUTCOME_LABELS: Readonly<Record<string, string>> = {
  APPROVED: 'Approved',
  REFUSED: 'Refused',
  WITHDRAWN: 'Withdrawn',
  CANCELLED: 'Cancelled',
  OTHER: 'Other',
};

const SHARE_STATUS_LABELS: Readonly<Record<string, string>> = {
  PENDING_ACCEPTANCE: 'not accepted yet',
  ACTIVE: 'active',
  PAUSED: 'paused',
  REVOKED: 'ended by you',
  EXPIRED: 'ended on its end date',
};

const snapshotName = (version: number | null): string =>
  version === null ? 'a snapshot' : `snapshot ${version}`;

/** A list key for one timeline record: its kind and record id, unique even at the same moment. */
export function eventKey(event: MemoryEvent): string {
  return `${event.kind}-${event.id}`;
}

/** One timeline record in plain words: a title and an optional second line. */
export function eventLine(event: MemoryEvent): {
  readonly title: string;
  readonly note: string | null;
} {
  switch (event.kind) {
    case 'prepared':
      return { title: `Snapshot ${event.snapshotVersion} prepared`, note: null };
    case 'confirmed':
      return {
        title: `Confirmed ${snapshotName(event.snapshotVersion)}`,
        note: event.setAsideAt
          ? `Set aside on ${formatTimestampDate(event.setAsideAt)} because the case changed. The snapshot itself is unchanged.`
          : null,
      };
    case 'correction_requested':
      return {
        title: `Asked for a correction to ${snapshotName(event.snapshotVersion)}`,
        note: null,
      };
    case 'not_accepted':
      return { title: `Did not accept ${snapshotName(event.snapshotVersion)}`, note: null };
    case 'shared':
      return {
        title: `Shared with ${event.recipientName ?? (event.recipientKind === 'organization' ? 'an agency' : 'a person')}`,
        note: `Share ${SHARE_STATUS_LABELS[event.status] ?? 'recorded'}.`,
      };
    case 'reported_submitted':
      return {
        title: `Reported as submitted by ${SUBMISSION_CHANNEL_LABELS[event.channel] ?? 'another way'}, using ${snapshotName(event.snapshotVersion)}`,
        note: `You recorded this on ${formatTimestampDate(event.recordedAt)}. VisaStack does not submit applications.`,
      };
    case 'outcome':
      return {
        title: `Decision recorded: ${OUTCOME_LABELS[event.decision] ?? 'Other'}`,
        note: `Recorded on ${formatTimestampDate(event.recordedAt)}.`,
      };
  }
}

/** Badge tone for each consistency result. Only a result that needs action is a warning. */
export const RESULT_TONES: Readonly<Record<ConsistencyResult, 'success' | 'warning' | 'neutral'>> =
  {
    CONSISTENT: 'success',
    LEGITIMATE_CHANGE: 'neutral',
    CONTEXT_DIFFERENCE: 'neutral',
    NEEDS_CLARIFICATION: 'warning',
    INSUFFICIENT_INFORMATION: 'warning',
  };

/** What to do next for each result, through the existing ways to fix a detail and confirm a case. */
export const RESULT_NEXT_STEPS: Readonly<
  Record<ConsistencyResult, { readonly text: string; readonly updateDetail: boolean }>
> = {
  CONSISTENT: {
    text: 'Nothing to do for this detail.',
    updateDetail: false,
  },
  LEGITIMATE_CHANGE: {
    text: 'The dates explain the change. Take a new snapshot of the case and confirm it, so the case uses the new value.',
    updateDetail: false,
  },
  CONTEXT_DIFFERENCE: {
    text: 'The two are not directly comparable, for example a different currency, before or after tax, or another recorded name. Check both are right, then confirm a new snapshot of the case.',
    updateDetail: false,
  },
  NEEDS_CLARIFICATION: {
    text: 'If one of them is wrong, save the right value with a note saying why. Then take a new snapshot and confirm it. A note is kept as your statement; on its own it does not settle the difference.',
    updateDetail: true,
  },
  INSUFFICIENT_INFORMATION: {
    text: 'Add the date each value became true, or the missing currency or tax detail, so the change can be understood. Then confirm a new snapshot of the case.',
    updateDetail: true,
  },
};

/** How a version was saved, in plain words. Never "verified": a status is not proof. */
export const FACT_STATUS_LABELS: Readonly<Record<string, string>> = {
  DECLARED: 'Entered by hand',
  EXTRACTED_PENDING: 'Read from a document, not checked yet',
  APPLICANT_CONFIRMED: 'Confirmed by you',
  DOCUMENT_SUPPORTED: 'Backed by a document',
  AGENCY_REVIEWED: 'Reviewed by an agency',
  CONFLICTED: 'Marked as not matching',
  STALE: 'Out of date',
  SUPERSEDED: 'Replaced by a newer version',
};

export const AMOUNT_BASIS_LABELS: Readonly<Record<'GROSS' | 'NET', string>> = {
  GROSS: 'Before tax',
  NET: 'After tax',
};

/** One sentence on where the review of a snapshot stands. A confirmation never changes a result. */
export function reviewSentence(
  version: number,
  review: {
    readonly confirmedAt: string | null;
    readonly setAsideAt: string | null;
    readonly laterConfirmation: { readonly at: string; readonly snapshotVersion: number } | null;
  },
): string {
  const own = !review.confirmedAt
    ? `Snapshot ${version} was not confirmed.`
    : review.setAsideAt
      ? `You confirmed snapshot ${version} on ${formatTimestampDate(review.confirmedAt)}. That confirmation was set aside on ${formatTimestampDate(review.setAsideAt)} because the case changed.`
      : `You confirmed snapshot ${version} on ${formatTimestampDate(review.confirmedAt)}, and that confirmation still stands.`;
  const later = review.laterConfirmation
    ? ` You later confirmed snapshot ${review.laterConfirmation.snapshotVersion} on ${formatTimestampDate(review.laterConfirmation.at)}.`
    : '';
  return own + later;
}
