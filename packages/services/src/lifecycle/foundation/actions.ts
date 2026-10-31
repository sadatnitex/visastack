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
  if (view.state === 'ARCHIVED') allowed.add('RESTORE');
  if (view.state === 'RECENTLY_DELETED') allowed.add('RESTORE_DELETED');
  if (live && view.pendingRequest) {
    allowed.add('CANCEL_REMOVAL_REQUEST');
  } else if (live && !view.legalHold) {
    const deletable = view.isDuplicate && view.duplicateBlockReason === null;
    if (deletable) allowed.add('DELETE_DUPLICATE');
    else if (view.requestsSwitchOn) allowed.add('REQUEST_REMOVAL');
  }
  return DOCUMENT_ACTIONS.filter((action) => allowed.has(action));
}
