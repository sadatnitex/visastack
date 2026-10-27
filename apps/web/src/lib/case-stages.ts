import type { MissionState } from '@visastack/core';

/** The name of each case stage, the one list every case screen shows. */
export const CASE_STATE_LABELS: Readonly<Record<MissionState, string>> = {
  DRAFT: 'Draft',
  INTAKE: 'Intake',
  IN_REVIEW: 'In Review',
  AWAITING_APPLICANT: 'Awaiting Applicant',
  SUBMISSION_READY: 'Submission Ready',
  SUBMITTED: 'Submitted',
  IN_PROGRESS: 'In Progress',
  READY_FOR_REVIEW: 'Ready for Review',
  UNDER_REVIEW: 'Under Review',
  READY_TO_EXPORT: 'Ready to Export',
  LOCKED: 'Locked',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
};

/** A stage's name; a value no stage has is shown as it is. */
export function caseStateLabel(state: string): string {
  return (CASE_STATE_LABELS as Readonly<Record<string, string>>)[state] ?? state;
}

/**
 * The next stages offered as stage buttons. Cancelling is final, so it is never one of them: it is
 * offered from the case page's More menu, behind a question (case-more-menu.tsx).
 */
export function stageButtonStates(nextStates: readonly MissionState[]): readonly MissionState[] {
  return nextStates.filter((state) => state !== 'CANCELLED');
}
