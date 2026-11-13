import {
  type ChangeImpact,
  IMPACT_OUTCOMES,
  type ImpactAbout,
  type ImpactItem,
  type ImpactNextStep,
  type ImpactReason,
  type ImpactSubject,
  emptyImpactCounts,
  outcomeForReason,
} from '@visastack/services';

/*
 * Made-up reviews for the What This Change Affects screens, typed against the contract
 * (packages/services/src/change-impact/contract.ts). Every name is invented. Between them the
 * reviews hold every reason at least once, both kinds of change, a preview and a recorded
 * change, a quiet change, and a review that could not check everything.
 */

export const APPLICANT_ID = 'a1111111-1111-4111-8111-111111111111';
export const TRAVELLER = 'Test Traveller Rahim';
export const AGENCY_A = 'Sample Agency A';
export const AGENCY_B = 'Sample Agency B';
export const PERSON = 'Sample Helper Nadia';
export const LIVE_CASE = 'Sample Japan Visit';
export const OTHER_LIVE_CASE = 'Sample Canada Study';
export const FINISHED_CASE = 'Sample Schengen Trip 2025';

export const SENT = new Date('2026-10-06T09:30:00Z');
export const DECIDED = new Date('2026-10-09T15:00:00Z');
const ASSESSED = new Date('2026-11-13T08:00:00Z');

const liveCase = (title = LIVE_CASE, missionId = 'm-live-1'): ImpactAbout => ({
  kind: 'CASE',
  missionId,
  title,
  live: true,
});
const finishedCase: ImpactAbout = {
  kind: 'CASE',
  missionId: 'm-done-1',
  title: FINISHED_CASE,
  live: false,
};

export function request(
  over: Partial<Extract<ImpactAbout, { kind: 'AGENCY_REQUEST' }>> = {},
): ImpactAbout {
  return {
    kind: 'AGENCY_REQUEST',
    source: 'EVIDENCE_REQUEST',
    requestId: 'r-1',
    organizationId: 'o-a',
    organizationName: AGENCY_A,
    missionId: 'm-live-1',
    caseTitle: LIVE_CASE,
    sentAt: SENT,
    decidedAt: null,
    ...over,
  };
}

export function share(over: Partial<Extract<ImpactAbout, { kind: 'SHARE' }>> = {}): ImpactAbout {
  return {
    kind: 'SHARE',
    grantId: 'g-1',
    recipientKind: 'ORGANIZATION',
    recipientName: AGENCY_B,
    reach: 'BY_NAME',
    ...over,
  };
}

const AREA_OF = { CASE: 'CASES', AGENCY_REQUEST: 'AGENCY_REQUESTS', SHARE: 'SHARING' } as const;

/** One item, with the outcome its reason always carries. */
export function item(
  reason: ImpactReason,
  about: ImpactAbout,
  nextStep: ImpactNextStep | null = null,
  id = `${reason}:${about.kind}`,
): ImpactItem {
  return {
    id,
    outcome: outcomeForReason(reason),
    reason,
    area: about.kind === 'AREA' ? about.area : AREA_OF[about.kind],
    about,
    nextStep,
  };
}

/** A review whose counts, order, quiet and complete follow from its items, as the service does. */
export function review(
  subject: ImpactSubject,
  phase: ChangeImpact['phase'],
  items: readonly ImpactItem[],
): ChangeImpact {
  const counts = emptyImpactCounts();
  for (const one of items) counts[one.outcome] += 1;
  return {
    subject,
    phase,
    items: [...items].sort(
      (x, y) => IMPACT_OUTCOMES.indexOf(x.outcome) - IMPACT_OUTCOMES.indexOf(y.outcome),
    ),
    counts,
    quiet: counts.ACTION_REQUIRED + counts.REVIEW_RECOMMENDED + counts.UNKNOWN === 0,
    complete: !items.some((one) => one.reason === 'COULD_NOT_CHECK'),
    assessedAt: ASSESSED,
  };
}

export const DOCUMENT_SUBJECT: ImpactSubject = {
  kind: 'DOCUMENT',
  documentId: 'd-old',
  title: 'Sample Passport 2019',
  replacement: { documentId: 'd-new', title: 'Sample Passport 2026' },
};

export const DETAIL_SUBJECT: ImpactSubject = {
  kind: 'DETAIL',
  factId: 'f-employer',
  label: 'Employer Name',
  changedAt: new Date('2026-11-12T10:00:00Z'),
  savedValues: 2,
};

const openCase: ImpactNextStep = { kind: 'OPEN_CASE', missionId: 'm-live-1' };
const openRequest: ImpactNextStep = { kind: 'OPEN_REQUEST', requestId: 'r-1' };
const openSharing: ImpactNextStep = { kind: 'OPEN_SHARING', grantId: 'g-1' };

/** Every reason a replaced document can meet. */
const DOCUMENT_ITEMS: readonly ImpactItem[] = [
  item('LIVE_CASE_USES_REPLACED_DOCUMENT', liveCase(), openCase),
  item('AGENCY_WAITING_FOR_REPLACEMENT', request(), openRequest),
  item('AGENCY_CHECKING_EARLIER', request({ requestId: 'r-2' }), {
    kind: 'OPEN_REQUEST',
    requestId: 'r-2',
  }),
  item('AGENCY_ACCEPTED_EARLIER_LIVE_WORK', request({ requestId: 'r-3', decidedAt: DECIDED }), {
    kind: 'OPEN_REQUEST',
    requestId: 'r-3',
  }),
  item('SHARE_COVERS_EARLIER_ONLY', share(), openSharing),
  item('LIVE_CASE_KEEPS_EARLIER_COPY', liveCase(OTHER_LIVE_CASE, 'm-live-2'), {
    kind: 'OPEN_CASE',
    missionId: 'm-live-2',
  }),
  item('RECORD_INCOMPLETE', request({ requestId: 'r-4', sentAt: null }), {
    kind: 'OPEN_REQUEST',
    requestId: 'r-4',
  }),
  item('FINISHED_CASE_KEPT', finishedCase),
  item(
    'AGENCY_ACCEPTED_EARLIER_FINISHED_WORK',
    request({ requestId: 'r-5', missionId: null, caseTitle: null, decidedAt: DECIDED }),
  ),
  item(
    'SHARE_ALREADY_COVERS',
    share({
      grantId: 'g-2',
      recipientKind: 'PERSON',
      recipientName: PERSON,
      reach: 'WHOLE_RECORD',
    }),
  ),
  item('AGENCY_HOLDS_CURRENT', request({ requestId: 'r-6', organizationName: AGENCY_B })),
];

/** A replaced document, recorded: every document reason at once. */
export const DOCUMENT_RECORDED = review(DOCUMENT_SUBJECT, 'RECORDED', DOCUMENT_ITEMS);

/** The same document before the replacement is recorded. */
export const DOCUMENT_PREVIEW = review(DOCUMENT_SUBJECT, 'PREVIEW', DOCUMENT_ITEMS);

/** A changed detail, recorded: every reason a detail can meet. */
export const DETAIL_RECORDED = review(DETAIL_SUBJECT, 'RECORDED', [
  item('LIVE_CASE_CONFIRMATION_VOID', liveCase(), openCase),
  item('AGENCY_WAITING_FOR_REPLACEMENT', request(), openRequest),
  item('AGENCY_CHECKING_EARLIER', request({ requestId: 'r-2' }), {
    kind: 'OPEN_REQUEST',
    requestId: 'r-2',
  }),
  item(
    'AGENCY_ACCEPTED_EARLIER_LIVE_WORK',
    request({ requestId: 'r-3', source: 'COLLECTION_RESPONSE', decidedAt: DECIDED }),
    { kind: 'OPEN_REQUEST', requestId: 'r-3' },
  ),
  item('SENT_BEFORE_EXACT_VERSIONS', request({ requestId: 'r-7' }), {
    kind: 'OPEN_REQUEST',
    requestId: 'r-7',
  }),
  item('FINISHED_CASE_NO_SAVED_COPY', finishedCase),
  item('FINISHED_CASE_KEPT', { ...finishedCase, missionId: 'm-done-2' }, null, 'kept-2'),
  item('AGENCY_ACCEPTED_EARLIER_FINISHED_WORK', request({ requestId: 'r-5', decidedAt: DECIDED })),
  item('LIVE_CASE_FOLLOWS_CURRENT', liveCase(OTHER_LIVE_CASE, 'm-live-2')),
  item('SHARE_ALREADY_COVERS', share({ reach: 'WHOLE_RECORD' })),
  item('AGENCY_HOLDS_CURRENT', request({ requestId: 'r-6', organizationName: AGENCY_B })),
]);

/** A part of the record could not be read: the review says so and is not complete. */
export const DETAIL_INCOMPLETE = review(DETAIL_SUBJECT, 'RECORDED', [
  item('LIVE_CASE_CONFIRMATION_VOID', liveCase(), openCase),
  item('COULD_NOT_CHECK', { kind: 'AREA', area: 'AGENCY_REQUESTS' }),
  item('COULD_NOT_CHECK', { kind: 'AREA', area: 'SHARING' }, null, 'could-not-check-sharing'),
]);

/** A replacement chain cut by a document removed for good: one item, about copies sent to agencies. */
export const DOCUMENT_CHAIN_CUT = review({ ...DOCUMENT_SUBJECT, replacement: null }, 'RECORDED', [
  item('RECORD_INCOMPLETE', { kind: 'AREA', area: 'AGENCY_REQUESTS' }, null, 'chain:cut'),
]);

/** Nothing uses the changed item at all. */
export const QUIET_EMPTY = review(
  { ...DETAIL_SUBJECT, changedAt: null, savedValues: 1 },
  'RECORDED',
  [],
);

/** Quiet, with records that relate to the change and need nothing. */
export const QUIET_WITH_HISTORY = review(DOCUMENT_SUBJECT, 'RECORDED', [
  item('FINISHED_CASE_KEPT', finishedCase),
  item('SHARE_ALREADY_COVERS', share({ reach: 'CATEGORY' })),
]);

/** A document with no newer one named, and sends whose dates were never recorded. */
export const DOCUMENT_UNDATED = review({ ...DOCUMENT_SUBJECT, replacement: null }, 'RECORDED', [
  item('AGENCY_WAITING_FOR_REPLACEMENT', request({ sentAt: null }), openRequest),
  item('AGENCY_CHECKING_EARLIER', request({ requestId: 'r-2', sentAt: null }), {
    kind: 'OPEN_REQUEST',
    requestId: 'r-2',
  }),
  item('SHARE_COVERS_EARLIER_ONLY', share({ reach: 'CATEGORY' }), openSharing),
  item('SENT_BEFORE_EXACT_VERSIONS', request({ requestId: 'r-7', sentAt: null })),
]);

/** An answered checklist: listed with the person's answers, and its agency may no longer be named. */
const checklist = (over: Parameters<typeof request>[0] = {}) =>
  request({
    source: 'COLLECTION_RESPONSE',
    requestId: 'a-1',
    missionId: null,
    caseTitle: null,
    ...over,
  });

const CHECKLIST_ITEMS: readonly ImpactItem[] = [
  item(
    'CHECKLIST_ANSWER_HOLDS_EARLIER',
    checklist(),
    { kind: 'OPEN_REQUEST', requestId: 'a-1' },
    'response:a-1',
  ),
  item(
    'CHECKLIST_ANSWER_HOLDS_EARLIER',
    checklist({ requestId: 'a-2', organizationName: '', sentAt: null }),
    { kind: 'OPEN_REQUEST', requestId: 'a-2' },
    'response:a-2',
  ),
  item(
    'AGENCY_HOLDS_CURRENT',
    checklist({ requestId: 'a-3', organizationName: '' }),
    null,
    'response:a-3',
  ),
];

export const CHECKLIST_DOCUMENT_RECORDED = review(DOCUMENT_SUBJECT, 'RECORDED', CHECKLIST_ITEMS);
export const CHECKLIST_DOCUMENT_PREVIEW = review(DOCUMENT_SUBJECT, 'PREVIEW', CHECKLIST_ITEMS);
export const CHECKLIST_DETAIL = review(DETAIL_SUBJECT, 'RECORDED', CHECKLIST_ITEMS);

export const ALL_REVIEWS = {
  CHECKLIST_DOCUMENT_RECORDED,
  CHECKLIST_DOCUMENT_PREVIEW,
  CHECKLIST_DETAIL,
  DOCUMENT_RECORDED,
  DOCUMENT_PREVIEW,
  DETAIL_RECORDED,
  DETAIL_INCOMPLETE,
  QUIET_EMPTY,
  QUIET_WITH_HISTORY,
  DOCUMENT_UNDATED,
} as const;
