import type { CaseTriageSummary } from '@visastack/services';
import { plural } from '../../../../lib/plural';
import { CLOSED_CASE_STATES } from './do-next';

/**
 * The Glance line on Agency Cases (CCD-6): what on one case waits for this person. Runs on the
 * server; the screen gets the words. Three things can:
 * - open tasks assigned to them;
 * - items the traveller sent that wait for a review. A checklist item is reviewed by recording a
 *   decision, which only someone assigned to the case can do; a reply to a request is reviewed
 *   by an administrator. Requests are administrator data, so a member's summary never holds any;
 * - for an administrator, a case nobody is assigned to (as Agency Overview's "Assign Someone").
 * A closed, cancelled or submitted case needs nothing, as on Agency Overview.
 */
export function caseNeedsYou(input: {
  readonly viewerAccountId: string;
  readonly admin: boolean;
  readonly state: string;
  readonly viewerAssigned: boolean;
  readonly assignmentCount: number;
  readonly tasks: readonly {
    readonly status: string;
    readonly assigneeAccountId: string | null;
  }[];
  readonly triage: Pick<CaseTriageSummary, 'items'>;
}): string {
  const nothing = 'Nothing needs you on this case right now.';
  if (CLOSED_CASE_STATES.has(input.state)) return nothing;
  const tasks = input.tasks.filter(
    (task) =>
      (task.status === 'OPEN' || task.status === 'IN_PROGRESS') &&
      task.assigneeAccountId === input.viewerAccountId,
  ).length;
  const toReview = input.triage.items.filter(
    (item) =>
      item.group === 'RECEIVED' &&
      (input.viewerAssigned || (input.admin && item.requestId !== null)),
  ).length;
  const parts = [
    ...(tasks > 0 ? [plural(tasks, 'task')] : []),
    ...(toReview > 0 ? [`${plural(toReview, 'item')} to review`] : []),
    ...(input.admin && input.assignmentCount === 0 ? ['someone to look after it'] : []),
  ];
  if (parts.length === 0) return nothing;
  const last = parts.pop();
  return `Needs you: ${parts.length > 0 ? `${parts.join(', ')} and ${last}` : last}.`;
}
