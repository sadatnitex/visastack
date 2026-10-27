import { daysUntilDueDay } from '@visastack/services';

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
  // Received, not Submitted: Submitted is reserved for a recorded submission to an authority (W0 L7).
  RECEIVED: { label: 'Received', tone: 'badge-neutral' },
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

/**
 * Task statuses that still need someone: not done and not cancelled. A started task past its due
 * date is overdue too, the same rule the reminder emails use (WP-V4 W0 ledger H4).
 */
export const LIVE_TASK_STATUSES: ReadonlySet<string> = new Set(['OPEN', 'IN_PROGRESS']);

/**
 * Whole days from today to a due day, negative once it has passed. A due date is a calendar day
 * (entered as a date and stored as UTC midnight), and the traveller's time zone decides when that
 * day ends (owner decision 26 Oct 2026, ADR 0015 amendment): the same rule as the traveller's Home
 * and evidence page (`daysUntilDueDay`). UTC only when no time zone is known.
 */
export function daysUntilDue(
  dueDate: Date | string,
  now: Date,
  timezone: string | null | undefined,
): number {
  return daysUntilDueDay(new Date(dueDate), now, timezone || 'UTC');
}

/** A task's own due day rule: its own time zone when it has one, else the traveller's. */
export interface DueTask {
  readonly status: string;
  readonly dueDate: string | null;
  readonly dueTimezone?: string | null;
}

/**
 * A case's tasks that are still live and past their due date: only once the due day has ended in
 * the task's own time zone, else the traveller's (`daysUntilDue`). A task due today is not yet
 * past due.
 */
export function overdueTasks<T extends DueTask>(
  tasks: readonly T[],
  now: Date = new Date(),
  travellerTimezone?: string | null,
): T[] {
  return tasks.filter(
    (t) =>
      LIVE_TASK_STATUSES.has(t.status) &&
      t.dueDate !== null &&
      daysUntilDue(t.dueDate, now, t.dueTimezone || travellerTimezone) < 0,
  );
}

/**
 * Request statuses that wait on the traveller: a first request, and one sent back for a fix.
 * The Dashboard count, the Waiting on Traveller view and Do Next all use this one rule.
 */
export const WAITING_ON_TRAVELLER_STATUSES: ReadonlySet<string> = new Set([
  'OPEN',
  'NEEDS_REPLACEMENT',
]);

/** How many of a case's tasks are still live and past their due date. */
export function countOverdueTasks(
  tasks: readonly DueTask[],
  now: Date = new Date(),
  travellerTimezone?: string | null,
): number {
  return overdueTasks(tasks, now, travellerTimezone).length;
}

export interface AttentionSummary {
  /** Cases this person can see. */
  readonly cases: number;
  /** Visible cases with nobody assigned. Only an administrator can assign, so only they are told. */
  readonly needAssignment: number | null;
  /** Evidence requests still waiting on the applicant (open or sent back for a fix). Administrators only (the list is administrator data). */
  readonly openRequests: number | null;
  /** Live (open or started) tasks past their due date across the visible cases. */
  readonly overdueTasks: number;
}

/**
 * The few counts shown at the top of the Dashboard. Each is computed from data
 * the console already loads, with the same definitions the per-case badges use
 * (overdue = open or started and its due day has ended; waiting on the applicant = open or sent
 * back for a fix; needs assignment = no assignee at all),
 * so a number here always agrees with what the Cases tab shows.
 */
export function summarizeAttention(input: {
  readonly admin: boolean;
  readonly cases: readonly {
    readonly assignments: readonly unknown[];
    readonly tasks: readonly DueTask[];
    readonly applicantTimezone?: string | null;
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
    openRequests: input.admin
      ? input.requests.filter((r) => WAITING_ON_TRAVELLER_STATUSES.has(r.status)).length
      : null,
    overdueTasks: input.cases.reduce(
      (sum, c) => sum + countOverdueTasks(c.tasks, now, c.applicantTimezone),
      0,
    ),
  };
}
