// Delete Duplicate, Recently Deleted and its purge (LC-C, PROGRAMME section 3 and lanes/C.md).
export {
  DELETE_DUPLICATE_REFUSALS,
  type DeleteDuplicateOutcome,
  type DeleteDuplicatePreview,
  RECENTLY_DELETED_DAYS,
  type SwitchedCase,
  deleteDuplicate,
  previewDeleteDuplicate,
} from './delete';
export { PURGE_BATCH_LIMIT, type PurgeDueDocumentsResult, purgeDueDocuments } from './purge';
export { RESTORE_REFUSALS, type RestoreSource, restoreDeleted, undoDelete } from './restore';
