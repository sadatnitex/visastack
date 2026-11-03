// Ask Us to Remove This File (LC-D, docs/roadmap/lifecycle/lanes/D.md).
export { FINISHED_CASE_STATES_FOR_REMOVAL, type RemovalImpact } from './effects';
export {
  DECLINE_REASON_WORDS,
  REMOVAL_DECLINE_CODES,
  REMOVAL_QUEUE_PAGE,
  REMOVAL_REQUEST_REASONS,
  REMOVAL_REQUEST_REFUSALS,
  type RemovalDecisionInput,
  type RemovalDecisionOutcome,
  type RemovalDeclineCode,
  type RemovalQueuePage,
  type RemovalQueueRow,
  type RemovalRequestReason,
  type RemovalSweepResult,
  type RequestRemovalOutcome,
  cancelRemovalRequest,
  decideRemovalRequest,
  listRemovalQueue,
  pendingRemovalRequests,
  requestRemoval,
  sweepRemovalRequests,
} from './requests';
export { REMOVAL_ALERT_WORKING_DAYS, addWorkingDays, workingDaysBetween } from './working-days';
// Delete My File (owner decision of 3 Nov 2026, PROGRAMME D12).
export {
  type DeleteMyFileInput,
  SELF_DELETE_IMPACT_KEYS,
  SELF_DELETE_REFUSALS,
  SELF_DELETE_WORD,
  type SelfDeleteImpact,
  type SelfDeleteOutcome,
  type SelfDeletePreview,
  deleteMyFile,
  previewDeleteMyFile,
} from './self-delete';
