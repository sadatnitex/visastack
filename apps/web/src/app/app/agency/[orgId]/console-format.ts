/**
 * Pure helpers shared by the agency console's pages (Dashboard, Clients, Cases,
 * Team, Settings). No React and no database, so they are unit-tested directly.
 */

export const ORG_STATUS: Record<string, { label: string; tone: string }> = {
  PENDING_VERIFICATION: { label: 'Pending Verification', tone: 'badge-warning' },
  ACTIVE: { label: 'Active', tone: 'badge-success' },
  SUSPENDED: { label: 'Suspended', tone: 'badge-danger' },
  REJECTED: { label: 'Rejected', tone: 'badge-danger' },
  CLOSED: { label: 'Closed', tone: 'badge-neutral' },
};

export const REQ_STATUS: Record<string, { label: string; tone: string }> = {
  OPEN: { label: 'Open', tone: 'badge-warning' },
  RECEIVED: { label: 'Submitted', tone: 'badge-neutral' },
  UNDER_REVIEW: { label: 'Under Review', tone: 'badge-neutral' },
  ACCEPTED: { label: 'Accepted', tone: 'badge-success' },
  NEEDS_REPLACEMENT: { label: 'Needs Replacement', tone: 'badge-warning' },
  CANCELLED: { label: 'Cancelled', tone: 'badge-neutral' },
  // Legacy: no longer written, but a pre-Part-4 request row may still hold one.
  FULFILLED: { label: 'Fulfilled', tone: 'badge-success' },
  DECLINED: { label: 'Declined', tone: 'badge-neutral' },
};

export const EVIDENCE_DECIDABLE_STATUSES: ReadonlySet<string> = new Set([
  'RECEIVED',
  'UNDER_REVIEW',
]);

// A case counts as "approaching" a date within this many days -- the same
// horizon the rest of this product has no existing precedent for, chosen as
// a reasonable default rather than derived from anything (Part 5's Expiry
// Centre, NTF-01, is the eventual home for a configurable version of this).
export const APPROACHING_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The soonest of a case's target deadline / travel start date that's still in the future and within APPROACHING_DAYS, or null. */
export function nextApproachingDate(
  targetDeadline: string | null,
  travelStartDate: string | null,
  now: number = Date.now(),
): { readonly label: string; readonly date: string } | null {
  const horizon = now + APPROACHING_DAYS * DAY_MS;
  const candidates: { label: string; date: string; ms: number }[] = [];
  if (targetDeadline) {
    const ms = new Date(targetDeadline).getTime();
    if (ms >= now && ms <= horizon)
      candidates.push({ label: 'Deadline', date: targetDeadline, ms });
  }
  if (travelStartDate) {
    const ms = new Date(travelStartDate).getTime();
    if (ms >= now && ms <= horizon) candidates.push({ label: 'Travel', date: travelStartDate, ms });
  }
  candidates.sort((a, b) => a.ms - b.ms);
  const soonest = candidates[0];
  return soonest ? { label: soonest.label, date: soonest.date } : null;
}

/** How many of a case's tasks are still open and past their due date. */
export function countOverdueTasks(
  tasks: readonly { readonly status: string; readonly dueDate: string | null }[],
  now: Date = new Date(),
): number {
  const nowIso = now.toISOString();
  return tasks.filter((t) => t.status === 'OPEN' && t.dueDate !== null && t.dueDate < nowIso)
    .length;
}

export interface AttentionSummary {
  /** Cases this person can see. */
  readonly cases: number;
  /** Visible cases with nobody assigned. Only an administrator can assign, so only they are told. */
  readonly needAssignment: number | null;
  /** Evidence requests still waiting on the applicant. Administrators only (the list is administrator data). */
  readonly openRequests: number | null;
  /** Open tasks past their due date across the visible cases. */
  readonly overdueTasks: number;
}

/**
 * The few counts shown at the top of the Dashboard. Each is computed from data
 * the console already loads, with the same definitions the per-case badges use
 * (overdue = open and past its due date; needs assignment = no assignee at all),
 * so a number here always agrees with what the Cases tab shows.
 */
export function summarizeAttention(input: {
  readonly admin: boolean;
  readonly cases: readonly {
    readonly assignments: readonly unknown[];
    readonly tasks: readonly { readonly status: string; readonly dueDate: string | null }[];
  }[];
  readonly requests: readonly { readonly status: string }[];
  readonly now?: Date;
}): AttentionSummary {
  const now = input.now ?? new Date();
  return {
    cases: input.cases.length,
    needAssignment: input.admin
      ? input.cases.filter((c) => c.assignments.length === 0).length
      : null,
    openRequests: input.admin ? input.requests.filter((r) => r.status === 'OPEN').length : null,
    overdueTasks: input.cases.reduce((sum, c) => sum + countOverdueTasks(c.tasks, now), 0),
  };
}
