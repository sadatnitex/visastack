import {
  type ChangeImpact,
  IMPACT_OUTCOMES,
  type ImpactAbout,
  type ImpactArea,
  type ImpactItem,
  type ImpactNextStep,
  type ImpactReason,
  type ImpactShareReach,
  type ImpactSubject,
  emptyImpactCounts,
  outcomeForReason,
} from './contract';

/*
 * The rules of "What This Change Affects", as pure functions over facts the readers loaded.
 * Nothing here reads a table, so each rule can be tested, and read, on its own. The contract
 * (`contract.ts`) is the authority for what each reason means; this file only decides which
 * reason a set of stored facts earns, and it never guesses: when the facts cannot settle it, the
 * answer is one of the UNKNOWN reasons.
 */

/** An item with the moment it is ordered by; `at` never leaves this module. */
export interface DraftItem {
  readonly item: ImpactItem;
  readonly at: Date | null;
}

function nextStepFor(about: ImpactAbout): ImpactNextStep | null {
  switch (about.kind) {
    case 'CASE':
      return { kind: 'OPEN_CASE', missionId: about.missionId };
    case 'AGENCY_REQUEST':
      return { kind: 'OPEN_REQUEST', requestId: about.requestId };
    case 'SHARE':
      return { kind: 'OPEN_SHARING', grantId: about.grantId };
    case 'AREA':
      return null;
  }
}

/**
 * One item. A next step is offered exactly when the contract allows one: for ACTION_REQUIRED,
 * REVIEW_RECOMMENDED and UNKNOWN items that have a record to open, never for HISTORY_PRESERVED or
 * NO_ACTION.
 */
function draftItem(
  id: string,
  area: ImpactArea,
  reason: ImpactReason,
  about: ImpactAbout,
  at: Date | null,
): DraftItem {
  const outcome = outcomeForReason(reason);
  const offers = outcome !== 'HISTORY_PRESERVED' && outcome !== 'NO_ACTION';
  return {
    item: { id, outcome, reason, area, about, nextStep: offers ? nextStepFor(about) : null },
    at,
  };
}

/** A part of the record that could not be read this time. */
export function couldNotCheck(area: ImpactArea): DraftItem {
  return draftItem(`area:${area}`, area, 'COULD_NOT_CHECK', { kind: 'AREA', area }, null);
}

/**
 * A chain of replacements cut by a document removed for good: whether a newer document exists,
 * and so whether copies of it were sent to agencies, cannot be found from the records. Said
 * once, about the copies sent to agencies; it is not a part that failed to be read.
 */
export function chainCutItem(): DraftItem {
  return draftItem(
    'chain:cut',
    'AGENCY_REQUESTS',
    'RECORD_INCOMPLETE',
    { kind: 'AREA', area: 'AGENCY_REQUESTS' },
    null,
  );
}

// ---------------------------------------------------------------------------------------------
// Cases

export interface CaseFacts {
  readonly missionId: string;
  readonly title: string;
  readonly live: boolean;
  readonly createdAt: Date;
}

/** One case with the reason the rules gave it. */
export function caseItem(facts: CaseFacts, reason: ImpactReason): DraftItem {
  return draftItem(
    `case:${facts.missionId}`,
    'CASES',
    reason,
    { kind: 'CASE', missionId: facts.missionId, title: facts.title, live: facts.live },
    facts.createdAt,
  );
}

export interface DocumentCaseFacts extends CaseFacts {
  /** The case selects the document. */
  readonly selects: boolean;
  /** The case holds a deliberate choice of this document's copy. */
  readonly keepsCopy: boolean;
  /**
   * The replacement is recorded and a confirmation of the case stands now: the traveller
   * confirmed the case again while it still used the earlier document.
   */
  readonly confirmedSinceReplaced: boolean;
  /** A finished case whose saved copy lists the document. */
  readonly savedCopyLists: boolean;
}

/** One case and a replaced (or about to be replaced) document. Null when the case is not affected. */
export function classifyDocumentCase(facts: DocumentCaseFacts): DraftItem | null {
  if (facts.live) {
    // A selection is the stronger tie: the case was flagged and its confirmation voided. Once
    // the traveller has confirmed the case again with the earlier document still selected, no
    // step is owed any more: keeping it is their choice, offered for review.
    if (facts.selects) {
      return caseItem(
        facts,
        facts.confirmedSinceReplaced
          ? 'LIVE_CASE_KEEPS_EARLIER_COPY'
          : 'LIVE_CASE_USES_REPLACED_DOCUMENT',
      );
    }
    if (facts.keepsCopy) return caseItem(facts, 'LIVE_CASE_KEEPS_EARLIER_COPY');
    return null;
  }
  // A replacement never alters the earlier document, so a finished case keeps it either way.
  if (facts.selects || facts.savedCopyLists) return caseItem(facts, 'FINISHED_CASE_KEPT');
  return null;
}

/** What a copy of a case recorded about one detail. */
export type RecordedDetail =
  /** No copy to read. */
  | { readonly kind: 'NO_COPY' }
  /** A copy exists and does not hold the detail. */
  | { readonly kind: 'ABSENT' }
  /** A copy holds the detail but did not record which saved value. */
  | { readonly kind: 'INEXACT' }
  /** A copy holds exactly these saved values of the detail. */
  | { readonly kind: 'VERSIONS'; readonly versionIds: readonly string[] };

export interface DetailCaseFacts extends CaseFacts {
  readonly selects: boolean;
  /** Live case: it was confirmed at some point. */
  readonly everConfirmed: boolean;
  /** Live case: a confirmation still stands. */
  readonly confirmationLive: boolean;
  /** Live case: what the latest confirmed copy recorded. Finished case: what its saved copy holds. */
  readonly recorded: RecordedDetail;
  /**
   * Live case: it holds a deliberate, still-standing choice of a saved value that is not the
   * current value.
   */
  readonly keepsEarlierValue: boolean;
  /**
   * Finished case: it existed while the detail held another value than the current one, so it
   * could have used an earlier value. A case made after the detail came to hold its current
   * value can only have held that value.
   */
  readonly couldHoldEarlier: boolean;
}

export interface DetailFacts {
  readonly currentVersionId: string | null;
  /** How many values were saved, including one saved again unchanged. */
  readonly savedValues: number;
  /**
   * The saved values that hold what the detail holds now: the current one, and any other whose
   * stored text is exactly the same (see `DetailSubject.versions`).
   */
  readonly sameValueIds: ReadonlySet<string>;
  /** At least one saved value differs from the current one. */
  readonly valueChanged: boolean;
}

/** The copy recorded only the current saved value itself. */
function recordedCurrentVersion(recorded: RecordedDetail, detail: DetailFacts): boolean {
  return (
    recorded.kind === 'VERSIONS' &&
    recorded.versionIds.length > 0 &&
    recorded.versionIds.every((id) => id === detail.currentVersionId)
  );
}

/** Everything the copy recorded holds what the detail holds now. */
function holdsCurrentValue(recorded: RecordedDetail, detail: DetailFacts): boolean {
  return (
    recorded.kind === 'VERSIONS' &&
    recorded.versionIds.length > 0 &&
    recorded.versionIds.every((id) => detail.sameValueIds.has(id))
  );
}

/** One case and a changed detail. Null when the case is not affected. */
export function classifyDetailCase(facts: DetailCaseFacts, detail: DetailFacts): DraftItem | null {
  if (facts.live) {
    if (!facts.selects && !facts.keepsEarlierValue) return null;
    const voided = facts.selects ? voidedConfirmation(facts, detail) : null;
    // A step the product already requires comes first; then a deliberate choice of an earlier
    // value, which the case keeps whatever the detail says now.
    if (voided === 'LIVE_CASE_CONFIRMATION_VOID') return caseItem(facts, voided);
    if (facts.keepsEarlierValue) return caseItem(facts, 'LIVE_CASE_KEEPS_EARLIER_COPY');
    return caseItem(facts, voided ?? 'LIVE_CASE_FOLLOWS_CURRENT');
  }
  // A finished case is judged by what its copy says: a copy that holds the same text as the
  // current value holds the current value, whichever saved value it names.
  switch (facts.recorded.kind) {
    case 'VERSIONS':
      return holdsCurrentValue(facts.recorded, detail)
        ? null
        : caseItem(facts, 'FINISHED_CASE_KEPT');
    case 'ABSENT':
      return null;
    case 'INEXACT':
      return facts.couldHoldEarlier ? caseItem(facts, 'RECORD_INCOMPLETE') : null;
    case 'NO_COPY':
      return facts.selects && facts.couldHoldEarlier
        ? caseItem(facts, 'FINISHED_CASE_NO_SAVED_COPY')
        : null;
  }
}

/**
 * What a live case's confirmation says about the detail: null when there is nothing to say (never
 * confirmed, a confirmation still stands, or the detail was only ever saved once).
 */
function voidedConfirmation(facts: DetailCaseFacts, detail: DetailFacts): ImpactReason | null {
  if (!facts.everConfirmed || facts.confirmationLive || detail.savedValues <= 1) return null;
  // Confirmed once, and that confirmation is void. A live case is judged by the saved value it
  // was confirmed with, not by its text: saving the detail again, even unchanged, voids the
  // confirmation by a product rule that is already enforced, and the traveller really must
  // confirm again. So a confirmed copy whose text equals the current one is still void.
  switch (facts.recorded.kind) {
    case 'VERSIONS':
      return recordedCurrentVersion(facts.recorded, detail)
        ? 'LIVE_CASE_FOLLOWS_CURRENT'
        : 'LIVE_CASE_CONFIRMATION_VOID';
    case 'ABSENT':
      // The detail was added after the confirmation: nothing was confirmed about it.
      return 'LIVE_CASE_FOLLOWS_CURRENT';
    case 'INEXACT':
    case 'NO_COPY':
      // A void confirmation whose copy cannot say which value it held.
      return 'RECORD_INCOMPLETE';
  }
}

// ---------------------------------------------------------------------------------------------
// Sends to agencies

/** Who the request waits on, from its stored status. */
export type RequestStanding = 'WAITING_ON_TRAVELLER' | 'WAITING_ON_AGENCY' | 'ANSWERED' | 'CLOSED';

/** The decision on the latest send. `SENT_BACK` covers needs replacement, contradiction and correction proposed. */
export type SendState = 'AWAITING_DECISION' | 'ACCEPTED' | 'SENT_BACK' | 'WITHDRAWN';

/** What the latest send carried, relative to the change. */
export type SendCarries =
  /** The replaced document, or a saved value other than the current one. */
  | 'EARLIER'
  /** The replacement document, or the current value. */
  | 'CURRENT'
  /** Not recorded exactly, and it could differ from what is current. */
  | 'UNPINNED'
  /** Something else: the request has moved on from the changed item. */
  | 'OTHER'
  /** The pinned record is gone or no longer matches what was sent. */
  | 'BROKEN';

export interface SendFacts {
  readonly standing: RequestStanding;
  /** The request's latest round; null when nothing is recorded as sent. */
  readonly latest: { readonly state: SendState; readonly carries: SendCarries } | null;
  /** The agency's work with the traveller is still live (see `agencyWorkIsLive`). */
  readonly liveWork: boolean;
  /**
   * The request belongs to a case that is closed or cancelled. Such a request is left out of
   * Needs Attention, so it is never an action here either; a request with no case is not affected.
   */
  readonly caseFinished: boolean;
  /**
   * True for a detail: a request that was sent back and waits on the traveller is about this
   * detail even when the value sent is still the current one.
   */
  readonly waitsEvenOnCurrent: boolean;
}

/**
 * Whether an agency's work with the traveller is live, for an accepted earlier send: the
 * request's case is live, or the request names no case the traveller can still open and the
 * agency still holds a live share.
 */
export function agencyWorkIsLive(input: {
  readonly caseLive: boolean | null;
  readonly agencyHoldsLiveShare: boolean;
}): boolean {
  return input.caseLive === null ? input.agencyHoldsLiveShare : input.caseLive;
}

/**
 * The reason one request (judged on its latest round) earns, or null when it is not listed:
 * a withdrawn send, a request cancelled or closed without acceptance, or one that has moved on.
 */
export function classifySend(facts: SendFacts): ImpactReason | null {
  const { standing, latest } = facts;
  if (latest === null) {
    // Answered or under review with no send on record: the history is missing.
    return standing === 'ANSWERED' || standing === 'WAITING_ON_AGENCY' ? 'RECORD_INCOMPLETE' : null;
  }
  if (latest.carries === 'OTHER') return null;
  if (latest.state === 'WITHDRAWN') return standing === 'CLOSED' ? null : 'RECORD_INCOMPLETE';
  if (standing === 'CLOSED') return latest.state === 'ACCEPTED' ? 'RECORD_INCOMPLETE' : null;

  // The request's status and the decision on its latest send must tell the same story.
  const agrees =
    (latest.state === 'AWAITING_DECISION' && standing === 'WAITING_ON_AGENCY') ||
    (latest.state === 'ACCEPTED' && standing === 'ANSWERED') ||
    (latest.state === 'SENT_BACK' && standing === 'WAITING_ON_TRAVELLER');
  if (!agrees || latest.carries === 'BROKEN') return 'RECORD_INCOMPLETE';

  if (latest.state === 'SENT_BACK') {
    // A request that carries the current copy and is not about this change is never listed.
    if (latest.carries === 'CURRENT' && !facts.waitsEvenOnCurrent) return null;
    if (facts.caseFinished) return 'AGENCY_REQUEST_ON_FINISHED_CASE';
    return 'AGENCY_WAITING_FOR_REPLACEMENT';
  }
  if (latest.carries === 'CURRENT') return 'AGENCY_HOLDS_CURRENT';
  if (latest.carries === 'UNPINNED') return 'SENT_BEFORE_EXACT_VERSIONS';
  if (latest.state === 'AWAITING_DECISION') return 'AGENCY_CHECKING_EARLIER';
  return facts.liveWork
    ? 'AGENCY_ACCEPTED_EARLIER_LIVE_WORK'
    : 'AGENCY_ACCEPTED_EARLIER_FINISHED_WORK';
}

const REQUEST_STANDING: Readonly<Record<string, RequestStanding>> = {
  OPEN: 'WAITING_ON_TRAVELLER',
  NEEDS_REPLACEMENT: 'WAITING_ON_TRAVELLER',
  RECEIVED: 'WAITING_ON_AGENCY',
  UNDER_REVIEW: 'WAITING_ON_AGENCY',
  ACCEPTED: 'ANSWERED',
  FULFILLED: 'ANSWERED',
  CANCELLED: 'CLOSED',
  DECLINED: 'CLOSED',
};

/** The standing of an evidence request from its stored status; an unknown status reads as closed. */
export function requestStanding(status: string): RequestStanding {
  return REQUEST_STANDING[status] ?? 'CLOSED';
}

/** The send state for a stored decision outcome, or for no decision on a request with this status. */
export function sendStateOf(outcome: string | null, requestStatus: string): SendState {
  if (outcome === null) return requestStatus === 'CANCELLED' ? 'WITHDRAWN' : 'AWAITING_DECISION';
  if (outcome === 'CANCELLED') return 'WITHDRAWN';
  return outcome === 'ACCEPTED' ? 'ACCEPTED' : 'SENT_BACK';
}

export interface AgencyRequestFacts {
  readonly source: 'EVIDENCE_REQUEST' | 'COLLECTION_RESPONSE';
  readonly requestId: string;
  readonly agencyId: string;
  readonly agencyName: string;
  readonly missionId: string | null;
  readonly caseTitle: string | null;
  readonly sentAt: Date | null;
  readonly decidedAt: Date | null;
  /** When the request itself was made: the ordering moment when nothing was sent. */
  readonly createdAt: Date;
}

export function agencyRequestItem(facts: AgencyRequestFacts, reason: ImpactReason): DraftItem {
  const prefix = facts.source === 'EVIDENCE_REQUEST' ? 'request' : 'response';
  return draftItem(
    `${prefix}:${facts.requestId}`,
    'AGENCY_REQUESTS',
    reason,
    {
      kind: 'AGENCY_REQUEST',
      source: facts.source,
      requestId: facts.requestId,
      organizationId: facts.agencyId,
      organizationName: facts.agencyName,
      missionId: facts.missionId,
      caseTitle: facts.caseTitle,
      sentAt: facts.sentAt,
      decidedAt: facts.decidedAt,
    },
    facts.sentAt ?? facts.createdAt,
  );
}

// ---------------------------------------------------------------------------------------------
// Sharing

export interface ShareFacts {
  readonly grantId: string;
  readonly recipientKind: 'ORGANIZATION' | 'PERSON';
  readonly recipientName: string;
  readonly reach: ImpactShareReach;
  readonly createdAt: Date;
}

/** One live share with the reason the rules gave it. */
export function shareItem(share: ShareFacts, reason: ImpactReason): DraftItem {
  return draftItem(
    `share:${share.grantId}`,
    'SHARING',
    reason,
    {
      kind: 'SHARE',
      grantId: share.grantId,
      recipientKind: share.recipientKind,
      recipientName: share.recipientName,
      reach: share.reach,
    },
    share.createdAt,
  );
}

/** What the policy evaluation said one live share lets its recipient open. */
export interface ShareReach {
  /** The changed document, or the detail. */
  readonly subject: boolean;
  /** The replacement document; null when there is none to ask about. */
  readonly replacement: boolean | null;
  /** A document of the same kind added later (asked only in a preview with no replacement named). */
  readonly laterDocument: boolean | null;
}

/** One live share and a replaced document. Null when the share does not reach the document. */
export function classifyDocumentShare(reach: ShareReach): ImpactReason | null {
  if (!reach.subject) return null;
  const coversNewer = reach.replacement ?? reach.laterDocument ?? false;
  return coversNewer ? 'SHARE_ALREADY_COVERS' : 'SHARE_COVERS_EARLIER_ONLY';
}

/** One live share and a changed detail: a share follows the detail, never one saved value. */
export function classifyDetailShare(reach: ShareReach): ImpactReason | null {
  return reach.subject ? 'SHARE_ALREADY_COVERS' : null;
}

// ---------------------------------------------------------------------------------------------
// The whole result

function compareDrafts(a: DraftItem, b: DraftItem): number {
  const byOutcome =
    IMPACT_OUTCOMES.indexOf(a.item.outcome) - IMPACT_OUTCOMES.indexOf(b.item.outcome);
  if (byOutcome !== 0) return byOutcome;
  // Newest first; an item with no moment (a part that could not be read) comes last.
  const byTime = (b.at?.getTime() ?? -1) - (a.at?.getTime() ?? -1);
  if (byTime !== 0) return byTime;
  return a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0;
}

/** Order the items, count them and decide `quiet` and `complete`. */
export function assembleImpact(input: {
  readonly subject: ImpactSubject;
  readonly phase: ChangeImpact['phase'];
  readonly drafts: readonly DraftItem[];
  readonly assessedAt: Date;
}): ChangeImpact {
  const items = [...input.drafts].sort(compareDrafts).map((draft) => draft.item);
  const counts = emptyImpactCounts();
  for (const item of items) counts[item.outcome] += 1;
  return {
    subject: input.subject,
    phase: input.phase,
    items,
    counts,
    quiet: counts.ACTION_REQUIRED + counts.REVIEW_RECOMMENDED + counts.UNKNOWN === 0,
    complete: !items.some((item) => item.reason === 'COULD_NOT_CHECK'),
    assessedAt: input.assessedAt,
  };
}
