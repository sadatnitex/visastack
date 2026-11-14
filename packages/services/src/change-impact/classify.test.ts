import { describe, expect, it } from 'vitest';
import {
  type DetailCaseFacts,
  type RecordedDetail,
  type RequestStanding,
  type SendCarries,
  type SendState,
  agencyWorkIsLive,
  assembleImpact,
  caseItem,
  classifyDetailCase,
  classifyDetailShare,
  classifyDocumentCase,
  classifyDocumentShare,
  classifySend,
  couldNotCheck,
  requestStanding,
  sendStateOf,
} from './classify';
import {
  IMPACT_OUTCOMES,
  IMPACT_REASON_OUTCOME,
  type ImpactReason,
  outcomeForReason,
} from './contract';

const AT = new Date('2026-11-01T00:00:00Z');
const CASE = { missionId: 'm1', title: 'Sample Case', createdAt: AT };

describe('a case and a replaced document', () => {
  const facts = (
    live: boolean,
    selects: boolean,
    keepsCopy: boolean,
    savedCopyLists: boolean,
    confirmedSinceReplaced = false,
  ) =>
    classifyDocumentCase({
      ...CASE,
      live,
      selects,
      keepsCopy,
      savedCopyLists,
      confirmedSinceReplaced,
    })?.item.reason ?? null;
  it('follows the rules in order of strength', () => {
    expect(facts(true, true, false, false)).toBe('LIVE_CASE_USES_REPLACED_DOCUMENT');
    expect(facts(true, true, true, false)).toBe('LIVE_CASE_USES_REPLACED_DOCUMENT');
    expect(facts(true, false, true, false)).toBe('LIVE_CASE_KEEPS_EARLIER_COPY');
    // Confirmed again with the earlier document still selected: no step is owed any more.
    expect(facts(true, true, false, false, true)).toBe('LIVE_CASE_KEEPS_EARLIER_COPY');
    expect(facts(false, true, false, false, true)).toBe('FINISHED_CASE_KEPT');
    expect(facts(true, false, false, true)).toBeNull();
    expect(facts(false, true, false, false)).toBe('FINISHED_CASE_KEPT');
    expect(facts(false, false, false, true)).toBe('FINISHED_CASE_KEPT');
    expect(facts(false, false, true, false)).toBeNull();
  });
});

describe('a case and a changed detail', () => {
  const detail = {
    currentVersionId: 'v2',
    savedValues: 2,
    sameValueIds: new Set(['v2']),
    valueChanged: true,
  };
  const once = {
    currentVersionId: 'v1',
    savedValues: 1,
    sameValueIds: new Set(['v1']),
    valueChanged: false,
  };
  /** Saved again unchanged: two saved values, the same text. */
  const resaved = {
    currentVersionId: 'v2',
    savedValues: 2,
    sameValueIds: new Set(['v1', 'v2']),
    valueChanged: false,
  };
  const base: DetailCaseFacts = {
    ...CASE,
    live: true,
    selects: true,
    everConfirmed: true,
    confirmationLive: false,
    recorded: { kind: 'VERSIONS', versionIds: ['v1'] },
    keepsEarlierValue: false,
    couldHoldEarlier: true,
  };
  const reason = (facts: Partial<DetailCaseFacts>, of = detail) =>
    classifyDetailCase({ ...base, ...facts }, of)?.item.reason ?? null;
  const recorded = (kind: RecordedDetail['kind'], versionIds: string[] = []): RecordedDetail =>
    kind === 'VERSIONS' ? { kind, versionIds } : { kind };

  it('judges a live case by its confirmation and the value that was confirmed', () => {
    expect(reason({})).toBe('LIVE_CASE_CONFIRMATION_VOID');
    expect(reason({ recorded: recorded('VERSIONS', ['v2']) })).toBe('LIVE_CASE_FOLLOWS_CURRENT');
    expect(reason({ recorded: recorded('VERSIONS', ['v1', 'v2']) })).toBe(
      'LIVE_CASE_CONFIRMATION_VOID',
    );
    expect(reason({ confirmationLive: true })).toBe('LIVE_CASE_FOLLOWS_CURRENT');
    expect(reason({ everConfirmed: false })).toBe('LIVE_CASE_FOLLOWS_CURRENT');
    expect(reason({ recorded: recorded('ABSENT') })).toBe('LIVE_CASE_FOLLOWS_CURRENT');
    expect(reason({ recorded: recorded('INEXACT') })).toBe('RECORD_INCOMPLETE');
    expect(reason({}, once)).toBe('LIVE_CASE_FOLLOWS_CURRENT');
    expect(reason({ selects: false })).toBeNull();
  });

  it('treats a value saved again unchanged as the current value, except for a void confirmation', () => {
    const finished = { live: false, everConfirmed: false, couldHoldEarlier: false };
    // A finished case whose copy names the earlier saved value with the same text: nothing to say.
    expect(reason(finished, resaved)).toBeNull();
    expect(reason({ ...finished, recorded: recorded('NO_COPY') }, resaved)).toBeNull();
    expect(reason({ ...finished, recorded: recorded('INEXACT') }, resaved)).toBeNull();
    // A live case whose confirmation was voided by the save must still be confirmed again.
    expect(reason({}, resaved)).toBe('LIVE_CASE_CONFIRMATION_VOID');
    expect(reason({ confirmationLive: true }, resaved)).toBe('LIVE_CASE_FOLLOWS_CURRENT');
  });

  it('offers a deliberate choice of an earlier value for review, after a void confirmation', () => {
    const chosen = { keepsEarlierValue: true };
    // The void confirmation is a step the product already requires: it comes first.
    expect(reason(chosen)).toBe('LIVE_CASE_CONFIRMATION_VOID');
    expect(reason({ ...chosen, confirmationLive: true })).toBe('LIVE_CASE_KEEPS_EARLIER_COPY');
    expect(reason({ ...chosen, everConfirmed: false })).toBe('LIVE_CASE_KEEPS_EARLIER_COPY');
    expect(reason({ ...chosen, selects: false })).toBe('LIVE_CASE_KEEPS_EARLIER_COPY');
    expect(reason({ ...chosen, recorded: recorded('INEXACT') })).toBe(
      'LIVE_CASE_KEEPS_EARLIER_COPY',
    );
  });

  it('does not list a finished case that can only have held the current value', () => {
    const later = { live: false, everConfirmed: false, couldHoldEarlier: false };
    expect(reason({ ...later, recorded: recorded('NO_COPY') })).toBeNull();
    expect(reason({ ...later, recorded: recorded('INEXACT') })).toBeNull();
    // A copy that names an earlier value is still what it says.
    expect(reason(later)).toBe('FINISHED_CASE_KEPT');
  });

  it('judges a finished case by its saved copy', () => {
    const finished = { live: false, everConfirmed: false };
    expect(reason(finished)).toBe('FINISHED_CASE_KEPT');
    expect(reason({ ...finished, recorded: recorded('VERSIONS', ['v2']) })).toBeNull();
    expect(reason({ ...finished, recorded: recorded('NO_COPY') })).toBe(
      'FINISHED_CASE_NO_SAVED_COPY',
    );
    expect(
      reason({ ...finished, couldHoldEarlier: false, recorded: recorded('NO_COPY') }, once),
    ).toBeNull();
    expect(reason({ ...finished, recorded: recorded('NO_COPY'), selects: false })).toBeNull();
    expect(reason({ ...finished, recorded: recorded('ABSENT') })).toBeNull();
    expect(reason({ ...finished, recorded: recorded('INEXACT') })).toBe('RECORD_INCOMPLETE');
    expect(
      reason({ ...finished, couldHoldEarlier: false, recorded: recorded('INEXACT') }, once),
    ).toBeNull();
  });
});

describe('a send to an agency, judged on its latest round', () => {
  const judge = (
    standing: RequestStanding,
    state: SendState | null,
    carries: SendCarries = 'EARLIER',
    extra: { liveWork?: boolean; waitsEvenOnCurrent?: boolean; caseFinished?: boolean } = {},
  ) =>
    classifySend({
      standing,
      latest: state ? { state, carries } : null,
      liveWork: extra.liveWork ?? true,
      waitsEvenOnCurrent: extra.waitsEvenOnCurrent ?? false,
      caseFinished: extra.caseFinished ?? false,
    });

  it('names the earlier copy by where it stands', () => {
    expect(judge('WAITING_ON_AGENCY', 'AWAITING_DECISION')).toBe('AGENCY_CHECKING_EARLIER');
    expect(judge('ANSWERED', 'ACCEPTED')).toBe('AGENCY_ACCEPTED_EARLIER_LIVE_WORK');
    expect(judge('ANSWERED', 'ACCEPTED', 'EARLIER', { liveWork: false })).toBe(
      'AGENCY_ACCEPTED_EARLIER_FINISHED_WORK',
    );
    expect(judge('WAITING_ON_TRAVELLER', 'SENT_BACK')).toBe('AGENCY_WAITING_FOR_REPLACEMENT');
  });

  it('never asks for action on a request whose case has finished (closed or cancelled)', () => {
    // The agency sent it back and it still waits on the traveller, but the case it belongs to is
    // over, so it is history, not something to do (the same rule Needs Attention follows).
    for (const carries of ['EARLIER', 'UNPINNED', 'CURRENT'] as const) {
      expect(
        judge('WAITING_ON_TRAVELLER', 'SENT_BACK', carries, {
          caseFinished: true,
          waitsEvenOnCurrent: true,
        }),
      ).toBe('AGENCY_REQUEST_ON_FINISHED_CASE');
    }
    // A request on a live case, or on no case at all, is still a real obligation.
    expect(judge('WAITING_ON_TRAVELLER', 'SENT_BACK', 'EARLIER', { caseFinished: false })).toBe(
      'AGENCY_WAITING_FOR_REPLACEMENT',
    );
    // Missing or contradictory records are still reported as unknown, never turned into history.
    expect(judge('ANSWERED', 'SENT_BACK', 'EARLIER', { caseFinished: true })).toBe(
      'RECORD_INCOMPLETE',
    );
    expect(judge('WAITING_ON_TRAVELLER', 'SENT_BACK', 'BROKEN', { caseFinished: true })).toBe(
      'RECORD_INCOMPLETE',
    );
  });

  it('needs nothing when the agency holds the current copy or value', () => {
    expect(judge('WAITING_ON_AGENCY', 'AWAITING_DECISION', 'CURRENT')).toBe('AGENCY_HOLDS_CURRENT');
    expect(judge('ANSWERED', 'ACCEPTED', 'CURRENT')).toBe('AGENCY_HOLDS_CURRENT');
    // Sent back: a document request has moved on to the newer document; a detail request still waits.
    expect(judge('WAITING_ON_TRAVELLER', 'SENT_BACK', 'CURRENT')).toBeNull();
    expect(
      judge('WAITING_ON_TRAVELLER', 'SENT_BACK', 'CURRENT', { waitsEvenOnCurrent: true }),
    ).toBe('AGENCY_WAITING_FOR_REPLACEMENT');
  });

  it('says unknown, never a guess, for an unpinned send or a broken record', () => {
    expect(judge('WAITING_ON_AGENCY', 'AWAITING_DECISION', 'UNPINNED')).toBe(
      'SENT_BEFORE_EXACT_VERSIONS',
    );
    expect(judge('ANSWERED', 'ACCEPTED', 'UNPINNED')).toBe('SENT_BEFORE_EXACT_VERSIONS');
    // A request that waits on the traveller needs the step whatever exactly was sent.
    expect(judge('WAITING_ON_TRAVELLER', 'SENT_BACK', 'UNPINNED')).toBe(
      'AGENCY_WAITING_FOR_REPLACEMENT',
    );
    expect(judge('ANSWERED', 'ACCEPTED', 'BROKEN')).toBe('RECORD_INCOMPLETE');
    // Status and decision disagree.
    expect(judge('WAITING_ON_AGENCY', 'ACCEPTED')).toBe('RECORD_INCOMPLETE');
    expect(judge('ANSWERED', 'AWAITING_DECISION')).toBe('RECORD_INCOMPLETE');
    expect(judge('ANSWERED', 'SENT_BACK')).toBe('RECORD_INCOMPLETE');
    expect(judge('CLOSED', 'ACCEPTED')).toBe('RECORD_INCOMPLETE');
    expect(judge('WAITING_ON_AGENCY', 'WITHDRAWN')).toBe('RECORD_INCOMPLETE');
    // Answered or under review with no send on record.
    expect(judge('ANSWERED', null)).toBe('RECORD_INCOMPLETE');
    expect(judge('WAITING_ON_AGENCY', null)).toBe('RECORD_INCOMPLETE');
  });

  it('does not list a withdrawn send, a request closed without acceptance, or one that moved on', () => {
    expect(judge('CLOSED', 'WITHDRAWN')).toBeNull();
    expect(judge('CLOSED', 'AWAITING_DECISION')).toBeNull();
    expect(judge('CLOSED', 'SENT_BACK')).toBeNull();
    expect(judge('WAITING_ON_TRAVELLER', null)).toBeNull();
    expect(judge('CLOSED', null)).toBeNull();
    for (const standing of ['WAITING_ON_AGENCY', 'ANSWERED', 'WAITING_ON_TRAVELLER'] as const) {
      expect(judge(standing, 'ACCEPTED', 'OTHER')).toBeNull();
    }
  });

  it('reads standing and state from the stored words', () => {
    expect(requestStanding('OPEN')).toBe('WAITING_ON_TRAVELLER');
    expect(requestStanding('NEEDS_REPLACEMENT')).toBe('WAITING_ON_TRAVELLER');
    expect(requestStanding('RECEIVED')).toBe('WAITING_ON_AGENCY');
    expect(requestStanding('UNDER_REVIEW')).toBe('WAITING_ON_AGENCY');
    expect(requestStanding('ACCEPTED')).toBe('ANSWERED');
    expect(requestStanding('FULFILLED')).toBe('ANSWERED');
    expect(requestStanding('CANCELLED')).toBe('CLOSED');
    expect(requestStanding('DECLINED')).toBe('CLOSED');
    expect(requestStanding('SOMETHING_NEW')).toBe('CLOSED');
    expect(sendStateOf(null, 'RECEIVED')).toBe('AWAITING_DECISION');
    expect(sendStateOf(null, 'CANCELLED')).toBe('WITHDRAWN');
    expect(sendStateOf('CANCELLED', 'CANCELLED')).toBe('WITHDRAWN');
    expect(sendStateOf('ACCEPTED', 'ACCEPTED')).toBe('ACCEPTED');
    for (const outcome of ['NEEDS_REPLACEMENT', 'CONTRADICTION', 'CORRECTION_PROPOSED']) {
      expect(sendStateOf(outcome, 'NEEDS_REPLACEMENT')).toBe('SENT_BACK');
    }
  });

  it('calls work live by the case when one is named, else by a live share', () => {
    expect(agencyWorkIsLive({ caseLive: true, agencyHoldsLiveShare: false })).toBe(true);
    expect(agencyWorkIsLive({ caseLive: false, agencyHoldsLiveShare: true })).toBe(false);
    expect(agencyWorkIsLive({ caseLive: null, agencyHoldsLiveShare: true })).toBe(true);
    expect(agencyWorkIsLive({ caseLive: null, agencyHoldsLiveShare: false })).toBe(false);
  });
});

describe('a live share', () => {
  it('covers the newer document, only the earlier one, or neither', () => {
    const reach = (subject: boolean, replacement: boolean | null, later: boolean | null) =>
      classifyDocumentShare({ subject, replacement, laterDocument: later });
    expect(reach(true, true, null)).toBe('SHARE_ALREADY_COVERS');
    expect(reach(true, false, null)).toBe('SHARE_COVERS_EARLIER_ONLY');
    expect(reach(true, null, true)).toBe('SHARE_ALREADY_COVERS');
    expect(reach(true, null, false)).toBe('SHARE_COVERS_EARLIER_ONLY');
    expect(reach(true, null, null)).toBe('SHARE_COVERS_EARLIER_ONLY');
    expect(reach(false, true, null)).toBeNull();
    expect(classifyDetailShare({ subject: true, replacement: null, laterDocument: null })).toBe(
      'SHARE_ALREADY_COVERS',
    );
    expect(classifyDetailShare({ subject: false, replacement: null, laterDocument: null })).toBe(
      null,
    );
  });
});

describe('the whole result', () => {
  /** A case item whose id sorts as `id` (the case id is the item id after its prefix). */
  const make = (id: string, reason: ImpactReason, at: Date) =>
    caseItem({ missionId: id, title: 't', live: true, createdAt: at }, reason);

  it('offers a next step only where the contract allows one', () => {
    for (const reason of Object.keys(IMPACT_REASON_OUTCOME) as ImpactReason[]) {
      const { item } = make('x', reason, AT);
      const outcome = outcomeForReason(reason);
      expect(item.outcome).toBe(outcome);
      expect(item.nextStep !== null).toBe(
        outcome === 'ACTION_REQUIRED' || outcome === 'REVIEW_RECOMMENDED' || outcome === 'UNKNOWN',
      );
    }
    // A part that could not be read has no record to open.
    expect(couldNotCheck('SHARING').item).toEqual({
      id: 'area:SHARING',
      outcome: 'UNKNOWN',
      reason: 'COULD_NOT_CHECK',
      area: 'SHARING',
      about: { kind: 'AREA', area: 'SHARING' },
      nextStep: null,
    });
  });

  it('orders by outcome, then newest first, then id, and counts', () => {
    const older = new Date(AT.getTime() - 1000);
    const impact = assembleImpact({
      subject: { kind: 'DETAIL', factId: 'f', label: 'L', changedAt: null, savedValues: 2 },
      phase: 'RECORDED',
      assessedAt: AT,
      drafts: [
        make('e', 'LIVE_CASE_FOLLOWS_CURRENT', AT),
        make('d', 'FINISHED_CASE_KEPT', AT),
        couldNotCheck('CASES'),
        make('c2', 'RECORD_INCOMPLETE', AT),
        make('b-old', 'LIVE_CASE_KEEPS_EARLIER_COPY', older),
        make('b-new', 'LIVE_CASE_KEEPS_EARLIER_COPY', AT),
        make('a2', 'LIVE_CASE_CONFIRMATION_VOID', AT),
        make('a1', 'LIVE_CASE_CONFIRMATION_VOID', AT),
      ],
    });
    expect(impact.items.map((item) => item.id)).toEqual([
      'case:a1',
      'case:a2',
      'case:b-new',
      'case:b-old',
      'case:c2',
      'area:CASES',
      'case:d',
      'case:e',
    ]);
    expect(impact.items.map((item) => IMPACT_OUTCOMES.indexOf(item.outcome))).toEqual(
      [...impact.items.map((item) => IMPACT_OUTCOMES.indexOf(item.outcome))].sort((a, b) => a - b),
    );
    expect(impact.counts).toEqual({
      ACTION_REQUIRED: 2,
      REVIEW_RECOMMENDED: 2,
      UNKNOWN: 2,
      HISTORY_PRESERVED: 1,
      NO_ACTION: 1,
    });
    expect(impact.quiet).toBe(false);
    expect(impact.complete).toBe(false);
  });

  it('is quiet with only history and no-action items, and with none', () => {
    const subject = { kind: 'DETAIL', factId: 'f', label: 'L', changedAt: null, savedValues: 1 };
    const quiet = assembleImpact({
      subject: subject as never,
      phase: 'RECORDED',
      assessedAt: AT,
      drafts: [make('d', 'FINISHED_CASE_KEPT', AT), make('e', 'LIVE_CASE_FOLLOWS_CURRENT', AT)],
    });
    expect(quiet.quiet).toBe(true);
    expect(quiet.complete).toBe(true);
    const empty = assembleImpact({
      subject: subject as never,
      phase: 'RECORDED',
      assessedAt: AT,
      drafts: [],
    });
    expect(empty).toMatchObject({ items: [], quiet: true, complete: true });
  });
});
