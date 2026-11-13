import { type Locale, type MessageParams, catalogResolve } from '@visastack/i18n';
import type {
  ChangeImpact,
  ImpactAbout,
  ImpactArea,
  ImpactItem,
  ImpactOutcome,
  ImpactSubject,
} from '@visastack/services';
import { type ChangeImpactKey, changeImpactCatalog } from '../../../../../i18n/change-impact';
import { formatTimestampDate } from '../../../../../lib/format-date';

/*
 * The words and links of What This Change Affects, in one place: which sentence explains an item,
 * which existing screen its next step opens, and the address of the review itself. Nothing here
 * decides an outcome (packages/services/src/change-impact/contract.ts does); this only words it.
 * Safe for browser code: it takes types from the service and no values.
 */

/** Section headings, in the order a person reads them (the contract's `IMPACT_OUTCOMES` order). */
export const SECTION_HEADINGS = {
  ACTION_REQUIRED: 'changeImpact.section.actionRequired',
  REVIEW_RECOMMENDED: 'changeImpact.section.reviewRecommended',
  UNKNOWN: 'changeImpact.section.unknown',
  HISTORY_PRESERVED: 'changeImpact.section.historyPreserved',
  NO_ACTION: 'changeImpact.section.noAction',
} as const satisfies Record<ImpactOutcome, ChangeImpactKey>;

export const SECTION_ORDER = Object.keys(SECTION_HEADINGS) as readonly ImpactOutcome[];

/** Outcomes that may offer a next step. A finished or settled record never gets a link. */
const STEP_OUTCOMES: ReadonlySet<ImpactOutcome> = new Set([
  'ACTION_REQUIRED',
  'REVIEW_RECOMMENDED',
  'UNKNOWN',
]);

const AREA_NAMES = {
  CASES: 'changeImpact.about.areaCases',
  AGENCY_REQUESTS: 'changeImpact.about.areaRequests',
  SHARING: 'changeImpact.about.areaSharing',
} as const satisfies Record<ImpactArea, ChangeImpactKey>;

const COULD_NOT_CHECK = {
  CASES: 'changeImpact.reason.couldNotCheck.cases',
  AGENCY_REQUESTS: 'changeImpact.reason.couldNotCheck.requests',
  SHARING: 'changeImpact.reason.couldNotCheck.sharing',
} as const satisfies Record<ImpactArea, ChangeImpactKey>;

/** A message with the names it mentions and, when it has one, the date it mentions. */
export interface ImpactMessage {
  readonly key: ChangeImpactKey;
  readonly names: MessageParams;
  readonly date: Date | null;
}

/** What an item is about, as a kind ("Case") and a name, plus the case a request belongs to. */
export interface ImpactAboutWords {
  readonly kind: ChangeImpactKey;
  /** The name as stored (a case title, an agency, a recipient), or null for a part of the record. */
  readonly name: string | null;
  /** The message that names a part of the record, when `name` is null. */
  readonly nameKey: ChangeImpactKey | null;
  readonly forCase: string | null;
}

export function aboutWords(about: ImpactAbout): ImpactAboutWords {
  switch (about.kind) {
    case 'CASE':
      return {
        kind: about.live ? 'changeImpact.about.case' : 'changeImpact.about.finishedCase',
        name: about.title,
        nameKey: null,
        forCase: null,
      };
    case 'AGENCY_REQUEST':
      return {
        kind: 'changeImpact.about.request',
        // An agency that is no longer active has no name here; the row says so instead.
        name: about.organizationName || null,
        nameKey: about.organizationName ? null : 'changeImpact.about.agencyNotActive',
        forCase: about.caseTitle,
      };
    case 'SHARE':
      return {
        kind: 'changeImpact.about.share',
        name: about.recipientName,
        nameKey: null,
        forCase: null,
      };
    case 'AREA':
      return {
        kind: 'changeImpact.about.area',
        name: null,
        nameKey: AREA_NAMES[about.area],
        forCase: null,
      };
  }
}

/**
 * The one sentence that says why an item appears. Chosen by reason, then by what changed (a
 * document has copies, a detail has values), by whether the change is recorded yet, and by
 * whether the send it mentions has a date: a missing date gets its own sentence, never a gap.
 */
export function impactSentence(
  item: ImpactItem,
  subject: ImpactSubject['kind'],
  phase: ChangeImpact['phase'],
): ImpactMessage {
  const { about } = item;
  // A part of the record that could not be read has no name to put in any other sentence.
  if (about.kind === 'AREA') return { key: COULD_NOT_CHECK[about.area], names: {}, date: null };
  const document = subject === 'DOCUMENT';
  const preview = document && phase === 'PREVIEW';
  const request = about.kind === 'AGENCY_REQUEST' ? about : null;
  // Every slot a sentence can hold is filled from the record the item is about, so a sentence
  // never shows an empty name even if a reason arrives with an unexpected kind of record.
  const own =
    about.kind === 'CASE'
      ? about.title
      : about.kind === 'AGENCY_REQUEST'
        ? about.organizationName
        : about.recipientName;
  const names: MessageParams = {
    case: request?.caseTitle ?? own,
    agency: own,
    recipient: own,
  };
  const plain = (key: ChangeImpactKey): ImpactMessage => ({ key, names, date: null });
  const dated = (
    date: Date | null | undefined,
    withDate: ChangeImpactKey,
    withoutDate: ChangeImpactKey,
  ): ImpactMessage =>
    date ? { key: withDate, names, date } : { key: withoutDate, names, date: null };
  const sentAt = request?.sentAt;
  // An agency that is no longer active arrives without a name. The two reasons an answered
  // checklist can carry have their own sentences that name no agency; any other reason gets one
  // plain sentence rather than a sentence with a gap where the name belongs.
  const unnamed = request !== null && request.organizationName === '';
  if (
    unnamed &&
    item.reason !== 'AGENCY_HOLDS_CURRENT' &&
    item.reason !== 'CHECKLIST_ANSWER_HOLDS_EARLIER'
  )
    return plain('changeImpact.reason.agencyNotNamed');

  switch (item.reason) {
    case 'LIVE_CASE_USES_REPLACED_DOCUMENT':
      return plain(
        preview
          ? 'changeImpact.reason.caseUsesReplaced.preview'
          : 'changeImpact.reason.caseUsesReplaced.recorded',
      );
    case 'LIVE_CASE_CONFIRMATION_VOID':
      return plain('changeImpact.reason.caseConfirmationVoid');
    case 'AGENCY_WAITING_FOR_REPLACEMENT':
      return dated(
        sentAt,
        'changeImpact.reason.agencyWaiting.dated',
        'changeImpact.reason.agencyWaiting.noDate',
      );
    case 'AGENCY_CHECKING_EARLIER':
      if (preview)
        return dated(
          sentAt,
          'changeImpact.reason.agencyChecking.documentPreview',
          'changeImpact.reason.agencyChecking.documentPreviewNoDate',
        );
      return document
        ? dated(
            sentAt,
            'changeImpact.reason.agencyChecking.document',
            'changeImpact.reason.agencyChecking.documentNoDate',
          )
        : dated(
            sentAt,
            'changeImpact.reason.agencyChecking.detail',
            'changeImpact.reason.agencyChecking.detailNoDate',
          );
    case 'AGENCY_ACCEPTED_EARLIER_LIVE_WORK':
      if (preview)
        return dated(
          sentAt,
          'changeImpact.reason.agencyAcceptedLive.documentPreview',
          'changeImpact.reason.agencyAcceptedLive.documentPreviewNoDate',
        );
      return document
        ? dated(
            sentAt,
            'changeImpact.reason.agencyAcceptedLive.document',
            'changeImpact.reason.agencyAcceptedLive.documentNoDate',
          )
        : dated(
            sentAt,
            'changeImpact.reason.agencyAcceptedLive.detail',
            'changeImpact.reason.agencyAcceptedLive.detailNoDate',
          );
    case 'SHARE_COVERS_EARLIER_ONLY': {
      const byName = about.kind === 'SHARE' && about.reach === 'BY_NAME';
      if (preview)
        return plain(
          byName
            ? 'changeImpact.reason.shareEarlierOnly.byNamePreview'
            : 'changeImpact.reason.shareEarlierOnly.otherPreview',
        );
      return plain(
        byName
          ? 'changeImpact.reason.shareEarlierOnly.byName'
          : 'changeImpact.reason.shareEarlierOnly.other',
      );
    }
    case 'LIVE_CASE_KEEPS_EARLIER_COPY':
      if (preview) return plain('changeImpact.reason.caseKeepsEarlier.documentPreview');
      return plain(
        document
          ? 'changeImpact.reason.caseKeepsEarlier.document'
          : 'changeImpact.reason.caseKeepsEarlier.detail',
      );
    case 'SENT_BEFORE_EXACT_VERSIONS':
      return document
        ? dated(
            sentAt,
            'changeImpact.reason.sentBeforeVersions.document',
            'changeImpact.reason.sentBeforeVersions.documentNoDate',
          )
        : dated(
            sentAt,
            'changeImpact.reason.sentBeforeVersions.detail',
            'changeImpact.reason.sentBeforeVersions.detailNoDate',
          );
    case 'FINISHED_CASE_NO_SAVED_COPY':
      return plain(
        document
          ? 'changeImpact.reason.finishedCaseNoCopy.document'
          : 'changeImpact.reason.finishedCaseNoCopy.detail',
      );
    case 'RECORD_INCOMPLETE':
      if (about.kind === 'AGENCY_REQUEST')
        return plain('changeImpact.reason.recordIncomplete.request');
      if (about.kind === 'SHARE') return plain('changeImpact.reason.recordIncomplete.share');
      return plain('changeImpact.reason.recordIncomplete.case');
    case 'COULD_NOT_CHECK':
      return plain(COULD_NOT_CHECK[item.area]);
    case 'FINISHED_CASE_KEPT':
      if (preview) return plain('changeImpact.reason.finishedCaseKept.documentPreview');
      return plain(
        document
          ? 'changeImpact.reason.finishedCaseKept.document'
          : 'changeImpact.reason.finishedCaseKept.detail',
      );
    case 'AGENCY_ACCEPTED_EARLIER_FINISHED_WORK': {
      const decidedAt = request?.decidedAt;
      if (preview)
        return dated(
          sentAt,
          'changeImpact.reason.agencyAcceptedFinished.documentPreview',
          'changeImpact.reason.agencyAcceptedFinished.documentPreviewNoDate',
        );
      return document
        ? dated(
            decidedAt,
            'changeImpact.reason.agencyAcceptedFinished.document',
            'changeImpact.reason.agencyAcceptedFinished.documentNoDate',
          )
        : dated(
            decidedAt,
            'changeImpact.reason.agencyAcceptedFinished.detail',
            'changeImpact.reason.agencyAcceptedFinished.detailNoDate',
          );
    }
    case 'LIVE_CASE_FOLLOWS_CURRENT':
      return plain(
        document
          ? 'changeImpact.reason.caseFollowsCurrent.document'
          : 'changeImpact.reason.caseFollowsCurrent.detail',
      );
    case 'SHARE_ALREADY_COVERS':
      return plain('changeImpact.reason.shareAlreadyCovers');
    case 'AGENCY_HOLDS_CURRENT':
      if (preview)
        return plain(
          unnamed
            ? 'changeImpact.reason.agencyHoldsCurrent.documentPreviewNoAgency'
            : 'changeImpact.reason.agencyHoldsCurrent.documentPreview',
        );
      if (document)
        return plain(
          unnamed
            ? 'changeImpact.reason.agencyHoldsCurrent.documentNoAgency'
            : 'changeImpact.reason.agencyHoldsCurrent.document',
        );
      return plain(
        unnamed
          ? 'changeImpact.reason.agencyHoldsCurrent.detailNoAgency'
          : 'changeImpact.reason.agencyHoldsCurrent.detail',
      );
    case 'CHECKLIST_ANSWER_HOLDS_EARLIER':
      if (preview)
        return unnamed
          ? dated(
              sentAt,
              'changeImpact.reason.checklistAnswer.documentPreviewNoAgency',
              'changeImpact.reason.checklistAnswer.documentPreviewNoAgencyNoDate',
            )
          : dated(
              sentAt,
              'changeImpact.reason.checklistAnswer.documentPreview',
              'changeImpact.reason.checklistAnswer.documentPreviewNoDate',
            );
      if (document)
        return unnamed
          ? dated(
              sentAt,
              'changeImpact.reason.checklistAnswer.documentNoAgency',
              'changeImpact.reason.checklistAnswer.documentNoAgencyNoDate',
            )
          : dated(
              sentAt,
              'changeImpact.reason.checklistAnswer.document',
              'changeImpact.reason.checklistAnswer.documentNoDate',
            );
      return unnamed
        ? dated(
            sentAt,
            'changeImpact.reason.checklistAnswer.detailNoAgency',
            'changeImpact.reason.checklistAnswer.detailNoAgencyNoDate',
          )
        : dated(
            sentAt,
            'changeImpact.reason.checklistAnswer.detail',
            'changeImpact.reason.checklistAnswer.detailNoDate',
          );
  }
}

/** The opening line: what changed, and that the list below says what it means. */
export function introMessage(impact: ChangeImpact): ImpactMessage {
  const { subject } = impact;
  if (subject.kind === 'DETAIL') {
    const names = { detail: subject.label };
    return subject.changedAt
      ? { key: 'changeImpact.review.introDetail', names, date: subject.changedAt }
      : { key: 'changeImpact.review.introDetailNoDate', names, date: null };
  }
  if (!subject.replacement)
    return {
      key: 'changeImpact.review.introDocumentAlone',
      names: { document: subject.title },
      date: null,
    };
  return {
    key:
      impact.phase === 'PREVIEW'
        ? 'changeImpact.review.introDocumentPreview'
        : 'changeImpact.review.introDocument',
    names: { document: subject.title, newer: subject.replacement.title },
    date: null,
  };
}

/**
 * The values a message is filled with. A date is written in the language the sentence itself is
 * in, so a Bengali reader who gets an English sentence never sees Bengali digits inside it.
 */
export function messageParams(message: ImpactMessage, locale: Locale): MessageParams {
  if (!message.date) return message.names;
  const { lang } = catalogResolve(changeImpactCatalog, locale, message.key);
  return { ...message.names, date: formatTimestampDate(message.date, lang) };
}

/** The existing screen a next step opens, and the name of the link. */
export interface ImpactStepLink {
  readonly href: string;
  readonly label: ChangeImpactKey;
}

/**
 * Where an item's next step leads: always a screen that already owns the step. A finished or
 * settled record (Stays as It Was, Nothing to Do) never gets one, whatever the item carries.
 */
export function stepLink(item: ImpactItem, applicantId: string): ImpactStepLink | null {
  const step = item.nextStep;
  if (!step || !STEP_OUTCOMES.has(item.outcome)) return null;
  const applicant = `/app/applicant/${encodeURIComponent(applicantId)}`;
  switch (step.kind) {
    case 'OPEN_CASE':
      return {
        href: `/app/mission/${encodeURIComponent(step.missionId)}`,
        label: 'changeImpact.step.openCase',
      };
    case 'OPEN_REQUEST': {
      // An answered checklist is listed with the person's other answers, not on the Requests page.
      if (item.about.kind === 'AGENCY_REQUEST' && item.about.source === 'COLLECTION_RESPONSE')
        return { href: '/collect/account/answers', label: 'changeImpact.step.openAnswers' };
      const request = encodeURIComponent(step.requestId);
      return {
        href: `${applicant}/evidence?item=${request}#request-${request}`,
        label: 'changeImpact.step.openRequest',
      };
    }
    case 'OPEN_SHARING':
      return { href: `${applicant}/sharing`, label: 'changeImpact.step.openSharing' };
  }
}

/**
 * The address of the full review for one change. Every link to the page is built here (the
 * documents list, the replace flow, the saved-detail notice, a sent answer whose detail changed),
 * so the address is written once, as a destination the route check can read.
 */
export function changeImpactHref(
  applicantId: string,
  subject: Pick<ImpactSubject, 'kind'> & { readonly id: string },
): string {
  const name = subject.kind === 'DOCUMENT' ? 'document' : 'detail';
  const page = {
    href: `/app/applicant/${encodeURIComponent(applicantId)}/change-impact?${name}=${encodeURIComponent(subject.id)}`,
  };
  return page.href;
}

/** The id the review of a change is addressed by: the document's or the detail's. */
export function subjectId(subject: ImpactSubject): string {
  return subject.kind === 'DOCUMENT' ? subject.documentId : subject.factId;
}

/**
 * What the saved-detail line needs: three counts and an address. Plain values, so a server action
 * can hand it to the form that shows the saved line.
 */
export interface ChangeImpactSummary {
  readonly href: string;
  readonly actionRequired: number;
  readonly reviewRecommended: number;
  readonly unknown: number;
}

/** Null when the change is quiet: nothing new is shown for a change that affects nothing. */
export function changeImpactSummary(
  impact: ChangeImpact,
  applicantId: string,
): ChangeImpactSummary | null {
  if (impact.quiet) return null;
  return {
    href: changeImpactHref(applicantId, {
      kind: impact.subject.kind,
      id: subjectId(impact.subject),
    }),
    actionRequired: impact.counts.ACTION_REQUIRED,
    reviewRecommended: impact.counts.REVIEW_RECOMMENDED,
    unknown: impact.counts.UNKNOWN,
  };
}
