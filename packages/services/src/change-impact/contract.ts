/**
 * What This Change Affects: the shared contract.
 *
 * When a traveller replaces a document or changes a confirmed detail, this module answers one
 * question from records that already exist: what does that change mean for live cases, for copies
 * and answers already sent to agencies, for sharing already set up, and for finished work?
 *
 * It is a read. It writes nothing, sends nothing, shares nothing and repoints nothing. Every
 * consequence that needs a decision is completed in the screen that already owns it (the case,
 * the request, sharing).
 *
 * The five outcomes and the evidence each one needs (binding):
 *
 * ACTION_REQUIRED    A record that is still live depends on the changed item, and a product rule
 *                    that is already enforced makes a step by the traveller necessary:
 *                    - a live case still uses the replaced document (the case was flagged and its
 *                      confirmation voided when the replacement was recorded);
 *                    - a live case was confirmed with an earlier value of the detail and that
 *                      confirmation is now void;
 *                    - an agency sent back the earlier copy or answer and its request is waiting
 *                      on the traveller.
 *                    Never used for a guess about what a visa authority requires.
 *
 * REVIEW_RECOMMENDED A live relationship holds the earlier copy or value, but nothing proves a
 *                    correction is needed:
 *                    - an agency is still checking the earlier copy or answer;
 *                    - an agency accepted the earlier copy or answer and its work with the
 *                      traveller is still live;
 *                    - a share reaches the replaced document but not the newer one;
 *                    - a live case holds a deliberate choice of the earlier copy.
 *
 * HISTORY_PRESERVED  A finished record holds the earlier copy or value and stays exactly as it
 *                    was: a finished case with a saved copy, or an accepted send whose work is
 *                    over. Nothing is rewritten and nothing is asked of the traveller.
 *
 * NO_ACTION          A record relates to the changed item and needs nothing: a live case that
 *                    simply follows the current value, sharing that already covers the newer
 *                    record, an agency that already holds the current copy or value.
 *
 * UNKNOWN            The stored records cannot settle it: an answer sent before exact versions
 *                    were kept, a finished case with no saved copy whose detail changed, stored
 *                    history that is missing or contradicts itself, a part of the record that
 *                    could not be read, or an answer to an agency's checklist that holds the
 *                    earlier copy or value (its review is not part of this read). Said plainly,
 *                    never guessed in either direction.
 *
 * Distinctions that hold everywhere:
 * - A document is not a version. A send pins one exact copy; a newer document never replaces it.
 * - A current value is not the value that was sent. A send pins one exact saved value.
 * - Sharing is not viewing. A live share proves what a recipient may open, never that they opened
 *   or relied on anything. Wording says "can open", never "has seen".
 * - A live case is not a finished case. Finished means CLOSED, CANCELLED or SUBMITTED.
 * - A request waiting on the traveller is not an accepted send.
 * - A product rule is not a visa requirement. No item claims a legal or official obligation.
 * - A next step is an offer. Nothing happens until the traveller does it in the existing screen.
 *
 * Who may read it: only the record's own traveller. Every other caller (a stranger, an agency
 * member with or without a live share, a revoked or expired recipient, a helper acting for the
 * traveller) and every made-up id gets the central gate's single refusal, with the same lookups.
 * One agency's acceptance is therefore never visible to another agency.
 */

/** Listed in the order a person should read them. */
export const IMPACT_OUTCOMES = [
  'ACTION_REQUIRED',
  'REVIEW_RECOMMENDED',
  'UNKNOWN',
  'HISTORY_PRESERVED',
  'NO_ACTION',
] as const;
export type ImpactOutcome = (typeof IMPACT_OUTCOMES)[number];

/**
 * Why an item appears. Each reason belongs to exactly one outcome (`IMPACT_REASON_OUTCOME`), so
 * the classification is a lookup and cannot drift between the two kinds of change.
 */
export const IMPACT_REASON_OUTCOME = {
  // A live case still selects the replaced document.
  LIVE_CASE_USES_REPLACED_DOCUMENT: 'ACTION_REQUIRED',
  // A live case was confirmed with an earlier value of the detail; that confirmation is void.
  LIVE_CASE_CONFIRMATION_VOID: 'ACTION_REQUIRED',
  // The agency sent the earlier copy or answer back; the request waits on the traveller.
  AGENCY_WAITING_FOR_REPLACEMENT: 'ACTION_REQUIRED',

  // The agency has not decided on the earlier copy or answer yet.
  AGENCY_CHECKING_EARLIER: 'REVIEW_RECOMMENDED',
  // The agency accepted the earlier copy or answer and its work with the traveller is live.
  AGENCY_ACCEPTED_EARLIER_LIVE_WORK: 'REVIEW_RECOMMENDED',
  // A live share reaches the replaced document but not the newer one (for example it lists the
  // earlier document by name).
  SHARE_COVERS_EARLIER_ONLY: 'REVIEW_RECOMMENDED',
  // A live case holds a deliberate choice of the earlier copy.
  LIVE_CASE_KEEPS_EARLIER_COPY: 'REVIEW_RECOMMENDED',

  // The send was recorded before exact versions were kept: which value went is not known.
  SENT_BEFORE_EXACT_VERSIONS: 'UNKNOWN',
  // A finished case has no saved copy and the detail changed: what it used cannot be shown.
  FINISHED_CASE_NO_SAVED_COPY: 'UNKNOWN',
  // Stored history is missing or contradicts itself.
  RECORD_INCOMPLETE: 'UNKNOWN',
  // One part of the record could not be read this time.
  COULD_NOT_CHECK: 'UNKNOWN',
  // A live answer to an agency's checklist holds the earlier copy or value; where that answer
  // stands is shown in Your Answers, not here.
  CHECKLIST_ANSWER_HOLDS_EARLIER: 'UNKNOWN',

  // A finished case keeps the earlier copy or value in its saved copy.
  FINISHED_CASE_KEPT: 'HISTORY_PRESERVED',
  // The agency accepted the earlier copy or answer and that work is over.
  AGENCY_ACCEPTED_EARLIER_FINISHED_WORK: 'HISTORY_PRESERVED',

  // A live case follows the current value and has no confirmation to renew.
  LIVE_CASE_FOLLOWS_CURRENT: 'NO_ACTION',
  // A live share already covers the newer document or the current value.
  SHARE_ALREADY_COVERS: 'NO_ACTION',
  // The agency already holds the current copy or value.
  AGENCY_HOLDS_CURRENT: 'NO_ACTION',
} as const satisfies Record<string, ImpactOutcome>;
export type ImpactReason = keyof typeof IMPACT_REASON_OUTCOME;

/** The part of the record an item was found in; also names what `COULD_NOT_CHECK` missed. */
export const IMPACT_AREAS = ['CASES', 'AGENCY_REQUESTS', 'SHARING'] as const;
export type ImpactArea = (typeof IMPACT_AREAS)[number];

/** How a share reaches the changed item. */
export type ImpactShareReach = 'BY_NAME' | 'WHOLE_RECORD' | 'CATEGORY';

/** The record an item is about. Names are the traveller's own records, shown only to them. */
export type ImpactAbout =
  | {
      readonly kind: 'CASE';
      readonly missionId: string;
      readonly title: string;
      /** False for a closed, cancelled or submitted case. */
      readonly live: boolean;
    }
  | {
      readonly kind: 'AGENCY_REQUEST';
      /** `EVIDENCE_REQUEST`: one asked-for item. `COLLECTION_RESPONSE`: an answered checklist. */
      readonly source: 'EVIDENCE_REQUEST' | 'COLLECTION_RESPONSE';
      readonly requestId: string;
      readonly organizationId: string;
      /** Empty when the agency is not active; the interface then names no agency. */
      readonly organizationName: string;
      /** The case the request belongs to, when it names one the traveller can still open. */
      readonly missionId: string | null;
      readonly caseTitle: string | null;
      /** When the earlier copy or answer was sent; null when that was never recorded. */
      readonly sentAt: Date | null;
      /** When the agency decided on it; null while it waits or when unknown. */
      readonly decidedAt: Date | null;
    }
  | {
      readonly kind: 'SHARE';
      readonly grantId: string;
      readonly recipientKind: 'ORGANIZATION' | 'PERSON';
      readonly recipientName: string;
      readonly reach: ImpactShareReach;
    }
  | {
      /** A part of the record that could not be read; only with reason `COULD_NOT_CHECK`. */
      readonly kind: 'AREA';
      readonly area: ImpactArea;
    };

/**
 * The existing screen where the traveller can act. Offered for ACTION_REQUIRED and
 * REVIEW_RECOMMENDED items and for UNKNOWN items that have a record to open; never for
 * HISTORY_PRESERVED or NO_ACTION.
 */
export type ImpactNextStep =
  | { readonly kind: 'OPEN_CASE'; readonly missionId: string }
  | { readonly kind: 'OPEN_REQUEST'; readonly requestId: string }
  | { readonly kind: 'OPEN_SHARING'; readonly grantId: string };

export interface ImpactItem {
  /** Stable across reads of the same records: safe as a list key and for test comparison. */
  readonly id: string;
  readonly outcome: ImpactOutcome;
  readonly reason: ImpactReason;
  readonly area: ImpactArea;
  readonly about: ImpactAbout;
  readonly nextStep: ImpactNextStep | null;
}

/** What changed. Never carries a detail's value: a label and dates are enough to explain it. */
export type ImpactSubject =
  | {
      readonly kind: 'DOCUMENT';
      readonly documentId: string;
      readonly title: string;
      /**
       * The newest document that stands in for this one: the recorded replacement (following a
       * chain of replacements to its end), or the candidate named in a preview. Null when the
       * document has no replacement and none was named.
       */
      readonly replacement: { readonly documentId: string; readonly title: string } | null;
    }
  | {
      readonly kind: 'DETAIL';
      readonly factId: string;
      /** The detail's plain name, for example "Employer Name". */
      readonly label: string;
      /** When the current value was saved; null when the detail has no current value. */
      readonly changedAt: Date | null;
      /** How many values this detail has had. 1 means it was never changed. */
      readonly savedValues: number;
    };

export interface ChangeImpact {
  readonly subject: ImpactSubject;
  /**
   * `PREVIEW`: the document is not replaced yet; this is what recording the replacement would
   * mean. `RECORDED`: the change is already saved.
   */
  readonly phase: 'PREVIEW' | 'RECORDED';
  /** Ordered by `IMPACT_OUTCOMES`, then newest first, then by `id`. Deterministic. */
  readonly items: readonly ImpactItem[];
  readonly counts: Readonly<Record<ImpactOutcome, number>>;
  /**
   * True when nothing needs the traveller's eye: no ACTION_REQUIRED, REVIEW_RECOMMENDED or
   * UNKNOWN item. The interface stays quiet in that case.
   */
  readonly quiet: boolean;
  /** False when a part of the record could not be read; a `COULD_NOT_CHECK` item names it. */
  readonly complete: boolean;
  readonly assessedAt: Date;
}

export interface AssessDocumentChangeInput {
  readonly documentId: string;
  /**
   * Preview only: the newer document the traveller is about to choose. Ignored once a
   * replacement is recorded. Must belong to the same traveller.
   */
  readonly replacementDocumentId?: string;
}

export interface AssessDetailChangeInput {
  readonly factId: string;
}

export interface AssessChangeOptions {
  /** The moment to judge live shares and dates against. Defaults to now. */
  readonly now?: Date;
}

/** Zero for every outcome; the starting point for `ChangeImpact.counts`. */
export function emptyImpactCounts(): Record<ImpactOutcome, number> {
  return {
    ACTION_REQUIRED: 0,
    REVIEW_RECOMMENDED: 0,
    UNKNOWN: 0,
    HISTORY_PRESERVED: 0,
    NO_ACTION: 0,
  };
}

/** The outcome a reason always carries. */
export function outcomeForReason(reason: ImpactReason): ImpactOutcome {
  return IMPACT_REASON_OUTCOME[reason];
}

/*
 * The two reads that `./index.ts` exports, both taking the central access proof:
 *
 *   assessDocumentChangeImpact(
 *     access: AuthorizedApplicant<'MANAGE'>,
 *     input: AssessDocumentChangeInput,
 *     options?: AssessChangeOptions,
 *   ): Promise<Result<ChangeImpact, ServiceError>>
 *
 *   assessDetailChangeImpact(
 *     access: AuthorizedApplicant<'MANAGE'>,
 *     input: AssessDetailChangeInput,
 *     options?: AssessChangeOptions,
 *   ): Promise<Result<ChangeImpact, ServiceError>>
 */
