// Resource lifecycle foundation (LC-F, PROGRAMME section 3.2). Lanes import from here.
export { type LifecycleAccess, lifecycleAccessCovers, lifecycleScope } from './access';
export {
  DOCUMENT_ACTIONS,
  DOCUMENT_LIFECYCLE_STATES,
  type DocumentAction,
  type DocumentActionView,
  type DocumentLifecycleState,
  type DuplicateBlockReason,
  availableDocumentActions,
} from './actions';
export {
  everydayApplicantCondition,
  everydayDocumentCondition,
  presentApplicantCondition,
  presentDocumentCondition,
} from './conditions';
export { LIFECYCLE_RELATIONS, lifecycleTablesPresent } from './presence';
export {
  type AdvanceDeletionReceiptPatch,
  DELETION_RECEIPT_STATUSES,
  type DeletionReceiptStatus,
  type DeletionReceiptView,
  type OpenDeletionReceiptInput,
  type ReceiptEffects,
  advanceDeletionReceipt,
  listDeletionReceipts,
  mergeReceiptEffects,
  openDeletionReceipt,
  receiptEffectsSchema,
  receiptMoveAllowed,
} from './receipts';
export {
  type EnqueueDocumentRemovalInput,
  type EnqueueDocumentRemovalOutcome,
  enqueueDocumentRemoval,
} from './removal';
export { type DocumentLifecycle, getDocumentLifecycle, getDocumentLifecycles } from './state';
