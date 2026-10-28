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

/** Stages after which a case is no longer being worked on. */
const FINISHED_CASE_STATES: ReadonlySet<string> = new Set(['CLOSED', 'CANCELLED']);

/**
 * The cases still being worked on, the most recently changed first: the first one is "the case
 * you are on" on the traveller's page and the Cases page.
 */
export function openCasesNewestFirst<
  T extends { readonly state: string; readonly updatedAt: Date },
>(cases: readonly T[]): T[] {
  return cases
    .filter((item) => !FINISHED_CASE_STATES.has(item.state))
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}
