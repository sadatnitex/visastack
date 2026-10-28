import { plural } from '../../../../lib/plural';
import type { CaseTriageView } from './case-triage';

/**
 * The Glance line on Agency Cases (CCD-6): what on one case waits for this person. Two things
 * do: open tasks assigned to them, and items the traveller sent that wait for the agency to
 * review ("Received or Awaiting Confirmation"). Runs on the server; the screen gets the words.
 */
export function caseNeedsYou(input: {
  readonly viewerAccountId: string;
  readonly tasks: readonly {
    readonly status: string;
    readonly assigneeAccountId: string | null;
  }[];
  readonly triage: CaseTriageView;
}): string {
  const tasks = input.tasks.filter(
    (task) =>
      (task.status === 'OPEN' || task.status === 'IN_PROGRESS') &&
      task.assigneeAccountId === input.viewerAccountId,
  ).length;
  const toReview = input.triage.groups.find((g) => g.group === 'RECEIVED')?.items.length ?? 0;
  const parts = [
    ...(tasks > 0 ? [plural(tasks, 'task')] : []),
    ...(toReview > 0 ? [`${plural(toReview, 'item')} to review`] : []),
  ];
  return parts.length === 0
    ? 'Nothing needs you on this case right now.'
    : `Needs you: ${parts.join(' and ')}.`;
}
