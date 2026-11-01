import type { DocumentAction, DocumentActionView, DocumentLifecycle } from '@visastack/services';

const ACTIONS: readonly string[] = [
  'ARCHIVE',
  'RESTORE',
  'REPLACE',
  'DELETE_DUPLICATE',
  'RESTORE_DELETED',
  'REQUEST_REMOVAL',
  'CANCEL_REMOVAL_REQUEST',
];

/** True for one of the frozen `DOCUMENT_ACTIONS` values (a deep link's `action`). */
export function isDocumentAction(value: unknown): value is DocumentAction {
  return typeof value === 'string' && ACTIONS.includes(value);
}

/**
 * The facts `availableDocumentActions` decides from, for one document on the Documents page.
 * The lifecycle state and "replaced" are known now; whether it is a deletable duplicate (lane C),
 * a pending removal request and the request switch (lane D), and a legal hold (lanes C and D,
 * which own the refusals it causes) start as "no" and are filled by those lanes, so until then
 * only Archive, Restore and Replace can ever be offered.
 */
export function documentActionView(
  lifecycle: DocumentLifecycle,
  facts: Partial<
    Pick<
      DocumentActionView,
      'isDuplicate' | 'duplicateBlockReason' | 'pendingRequest' | 'legalHold' | 'requestsSwitchOn'
    >
  > = {},
): DocumentActionView {
  return {
    state: lifecycle.state,
    replaced: lifecycle.replaced,
    isDuplicate: facts.isDuplicate ?? false,
    duplicateBlockReason: facts.duplicateBlockReason ?? null,
    pendingRequest: facts.pendingRequest ?? false,
    legalHold: facts.legalHold ?? false,
    requestsSwitchOn: facts.requestsSwitchOn ?? false,
  };
}
