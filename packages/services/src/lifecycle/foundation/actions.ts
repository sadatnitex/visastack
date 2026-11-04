/**
 * Every action the Documents page Manage menu can offer, in the order it lists them. Frozen by
 * PROGRAMME section 3.2: lanes add a component for one of these, never a new value.
 */
export const DOCUMENT_ACTIONS = [
  'ARCHIVE',
  'RESTORE',
  'REPLACE',
  'DELETE_DUPLICATE',
  'RESTORE_DELETED',
  'REQUEST_REMOVAL',
  'CANCEL_REMOVAL_REQUEST',
  // Also Keep a Copy for Another Person (owner request of 4 Nov 2026): a document that belongs to
  // two people (a marriage certificate) can be kept under another person of the same account.
  // Placed before Delete My File, which stays last.
  'KEEP_COPY_FOR_PERSON',
  // Delete My File (owner decision of 3 Nov 2026, D12): added after the original seven, which the
  // owner approved by that decision; the lanes' frozen order is otherwise unchanged.
  'DELETE_MY_FILE',
] as const;

export type DocumentAction = (typeof DOCUMENT_ACTIONS)[number];

export const DOCUMENT_LIFECYCLE_STATES = [
  'CURRENT',
  'ARCHIVED',
  'RECENTLY_DELETED',
  'REMOVING',
] as const;

export type DocumentLifecycleState = (typeof DOCUMENT_LIFECYCLE_STATES)[number];

/** Why deleting a duplicate is refused (owner decision D5); Archive is offered instead. */
export type DuplicateBlockReason =
  | 'FINISHED_CASE'
  | 'AGENCY_REQUEST_ANSWER'
  | 'CONTRIBUTOR_HANDOVER'
  | 'SHARED_BY_NAME'
  | 'LEGAL_HOLD';

export interface DocumentActionView {
  readonly state: DocumentLifecycleState;
  /** A newer document replaced this one. */
  readonly replaced: boolean;
  /** Every version's fingerprint exists in another usable document of the same person that stays (D2). */
  readonly isDuplicate: boolean;
  readonly duplicateBlockReason: DuplicateBlockReason | null;
  /** A removal request for this document is waiting for support. */
  readonly pendingRequest: boolean;
  /** A legal hold covers this document (applicant-wide, the document, or a case selecting it). */
  readonly legalHold: boolean;
  /** "Ask Us to Remove This File" is switched on for this deployment (lane D). */
  readonly requestsSwitchOn: boolean;
  /**
   * "Delete My File" is switched on for this deployment (`DOCUMENT_SELF_DELETE`). Left out means
   * off, so a caller that does not know about it changes nothing.
   */
  readonly selfDeleteSwitchOn?: boolean;
  /**
   * The document is of a kind that belongs to two people and the account has someone else to keep
   * a copy for. Left out means no, so a caller that does not know about it changes nothing.
   */
  readonly keepCopyForOthers?: boolean;
}

/**
 * The actions the Manage menu offers for one document, in `DOCUMENT_ACTIONS` order. Pure: the
 * one place visibility is decided, so lanes never compute it themselves.
 *
 * - Current: Archive; Replace while not replaced yet.
 * - Archived: Restore.
 * - Current or Archived: Delete Duplicate for a deletable duplicate (D2, D5); otherwise Ask Us to
 *   Remove This File when requests are switched on (D1). A pending request offers only its
 *   cancel. A legal hold offers neither deletion nor a request.
 * - Current or Archived, with Delete My File switched on and no legal hold: Delete My File, last,
 *   whatever else is offered (a waiting request is closed by it). It is the owner's own instant
 *   removal; the service decides again who may use it and which files it refuses.
 * - Current, of a kind that belongs to two people, with someone else on the account: Also Keep a
 *   Copy for Another Person.
 * - Recently Deleted: Restore only.
 * - Being removed: nothing.
 */
export function availableDocumentActions(view: DocumentActionView): DocumentAction[] {
  const allowed = new Set<DocumentAction>();
  const live = view.state === 'CURRENT' || view.state === 'ARCHIVED';
  if (view.state === 'CURRENT') {
    allowed.add('ARCHIVE');
    if (!view.replaced) allowed.add('REPLACE');
  }
  if (view.state === 'CURRENT' && view.keepCopyForOthers === true) {
    allowed.add('KEEP_COPY_FOR_PERSON');
  }
  if (view.state === 'ARCHIVED') allowed.add('RESTORE');
  if (view.state === 'RECENTLY_DELETED') allowed.add('RESTORE_DELETED');
  if (live && view.pendingRequest) {
    allowed.add('CANCEL_REMOVAL_REQUEST');
  } else if (live && !view.legalHold) {
    const deletable = view.isDuplicate && view.duplicateBlockReason === null;
    if (deletable) allowed.add('DELETE_DUPLICATE');
    else if (view.requestsSwitchOn) allowed.add('REQUEST_REMOVAL');
  }
  if (live && !view.legalHold && view.selfDeleteSwitchOn === true) allowed.add('DELETE_MY_FILE');
  return DOCUMENT_ACTIONS.filter((action) => allowed.has(action));
}
