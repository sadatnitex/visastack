/**
 * Agency "Do next" (Programme X WP-V4, ADR-0015): one short, ranked list of what to do first,
 * built only from the E02 triage mapping and from data the dashboard already loads for this
 * person. It reads nothing new, so it can never show an item for a case the person cannot
 * already see, and a member who is not an administrator, who loads no requests, simply gets no
 * request items (and no error).
 *
 * Ranking, approved by the owner on 2026-10-25 (W0 ledger Q1, option A):
 *   1. Items asked of a traveller that are past their due date, oldest due date first. This
 *      includes items sent back for a fix.
 *   2. Items a traveller sent that are waiting for the agency to review.
 *   3. Cases with overdue tasks, most overdue first.
 *   4. Cases with nobody assigned (administrators only).
 * Ties: oldest created first, then by title, then by an internal key, so the order never jumps
 * around between visits. Closed, cancelled and submitted cases are left out. A case appears once
 * among the case rows: a case with overdue tasks and nobody assigned shows in row 3 with
 * "Nobody assigned" as its owner.
 */

import { type TriageDocumentState, evidenceRequestTriageGroup } from '@visastack/services';
import { formatDateOnly, formatTimestampDate } from '../../../../lib/format-date';
import { documentTypeLabel, titleCase } from '../../../../lib/labels';
import { fieldLabel } from '../../../../lib/master-profile';
import { type DueTask, daysUntilDue, overdueTasks } from './console-format';
import { type FollowUpMessage, buildFollowUpMessage } from './follow-up-message';

/** The Cases page anchor for one case (its row id is `mission-<id>`, a stored name kept in code). */
const CASE_ANCHOR = '/cases#mission-';

export type DoNextTier = 1 | 2 | 3 | 4;

export type DoNextAction =
  | { readonly kind: 'follow-up'; readonly label: string; readonly message: FollowUpMessage }
  | { readonly kind: 'link'; readonly label: string; readonly href: string };

export interface DoNextItem {
  /** Stable and unique within the list; used as the React key, never shown. */
  readonly key: string;
  readonly tier: DoNextTier;
  /** What the item is about: the thing asked for, or the case title. */
  readonly heading: string;
  readonly traveller: string;
  /** The case the item belongs to; null for a request made for the traveller in general. */
  readonly caseTitle: string | null;
  /** Who on the agency side looks after it. */
  readonly owner: string;
  /** Why it is on the list, in one plain sentence. */
  readonly reason: string;
  /** The one thing to do. */
  readonly action: DoNextAction;
}

export interface DoNextCase {
  readonly missionId: string;
  readonly applicantId: string;
  readonly applicantName: string;
  readonly title: string;
  readonly state: string;
  readonly createdAt?: string;
  /** The traveller's time zone: decides when a due day ends. Used, never shown. */
  readonly applicantTimezone?: string | null;
  readonly assignments: readonly {
    readonly memberAccountId: string;
    readonly memberEmail: string;
  }[];
  readonly tasks: readonly (DueTask & { readonly assigneeAccountId?: string | null })[];
}

export interface DoNextRequest {
  readonly id: string;
  readonly applicantId: string;
  readonly applicantName?: string;
  readonly missionId?: string | null;
  readonly kind: 'FIELD' | 'DOCUMENT';
  readonly fieldKey?: string | null;
  readonly docType?: string | null;
  readonly message?: string | null;
  readonly status: Parameters<typeof evidenceRequestTriageGroup>[0]['status'];
  readonly dueDate?: Date | string | null;
  readonly respondedAt?: Date | string | null;
  readonly createdAt?: Date | string;
  readonly requestedByAccountId?: string | null;
  /** The traveller's time zone: decides when the due day ends. Used, never shown. */
  readonly applicantTimezone?: string | null;
  /** The answered file's newest state, when loaded; see `loadEvidenceRequests`. */
  readonly respondingDocumentState?: TriageDocumentState | null;
  /** The request's visible code (ADR 0018), when it has one: named in the follow-up message. */
  readonly referenceCode?: string;
}

export interface DoNextInput {
  readonly admin: boolean;
  readonly viewerAccountId: string;
  /** The cases in view: already limited to what this person may see, and to any search on the page. */
  readonly cases: readonly DoNextCase[];
  /** Requests already loaded for this person (administrators only; empty for anyone else). */
  readonly requests: readonly DoNextRequest[];
  /**
   * Requests made for a traveller in general belong to no case. With no search on the page they
   * are all shown; with one, only those for a traveller who has a case in view.
   */
  readonly applicantWide: 'all' | 'travellers-in-view';
  /** The roster, when this person may read it, for naming owners. */
  readonly members: readonly { readonly accountId: string; readonly email: string }[];
  readonly organizationName: string | null;
  /** The console base path, for example /app/agency/<org>. */
  readonly base: string;
  readonly now?: Date;
}

/** Cases that are finished or handed over need nothing from the agency's list. */
const CLOSED_CASE_STATES: ReadonlySet<string> = new Set(['CLOSED', 'CANCELLED', 'SUBMITTED']);

const time = (value: Date | string | null | undefined): number => {
  if (value === null || value === undefined) return 0;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? 0 : ms;
};

/**
 * The thing a request asks for, in words. Server-only (it reads the field catalogue), so it lives
 * here rather than in `lib/labels.ts`, which browser code imports. Home uses it too.
 */
export function requestItemLabel(request: {
  readonly kind: string;
  readonly fieldKey?: string | null | undefined;
  readonly docType?: string | null | undefined;
}): string {
  if (request.kind === 'FIELD') {
    return request.fieldKey
      ? (fieldLabel(request.fieldKey) ?? titleCase(request.fieldKey))
      : 'Requested Detail';
  }
  return request.docType ? documentTypeLabel(request.docType) : 'Requested Document';
}

interface Ranked {
  readonly item: DoNextItem;
  /** Inside a tier: the due date for row 1, the oldest overdue task for row 3, otherwise 0. */
  readonly primary: number;
  readonly created: number;
}

export function buildDoNext(input: DoNextInput): DoNextItem[] {
  const now = input.now ?? new Date();
  const openCases = input.cases.filter((c) => !CLOSED_CASE_STATES.has(c.state));
  const caseById = new Map(openCases.map((c) => [c.missionId, c]));
  const travellersInView = new Set(openCases.map((c) => c.applicantId));

  const emailById = new Map<string, string>();
  for (const member of input.members) emailById.set(member.accountId, member.email);
  for (const c of input.cases) {
    for (const a of c.assignments) emailById.set(a.memberAccountId, a.memberEmail);
  }
  const personName = (accountId: string | null | undefined): string | null => {
    if (!accountId) return null;
    if (accountId === input.viewerAccountId) return 'You';
    return emailById.get(accountId) ?? 'A team member';
  };
  const caseOwners = (c: DoNextCase): string | null => {
    if (c.assignments.length === 0) return null;
    const names = c.assignments.map((a) => personName(a.memberAccountId) ?? a.memberEmail);
    // "You" first, then the others in the order the case lists them.
    return [...names.filter((n) => n === 'You'), ...names.filter((n) => n !== 'You')].join(', ');
  };

  const ranked: Ranked[] = [];

  // Rows 1 and 2: requests. Administrator data only, whatever was passed in.
  if (input.admin) {
    for (const request of input.requests) {
      const group = evidenceRequestTriageGroup(request, request.respondingDocumentState);
      if (group === null || group === 'REVIEWED') continue;
      const caseRow = request.missionId ? caseById.get(request.missionId) : undefined;
      if (request.missionId && !caseRow) continue; // a case not in view, or closed
      if (
        !request.missionId &&
        input.applicantWide === 'travellers-in-view' &&
        !travellersInView.has(request.applicantId)
      ) {
        continue;
      }

      const label = requestItemLabel(request);
      const traveller = caseRow?.applicantName ?? request.applicantName ?? 'Traveller';
      const owner =
        (caseRow ? caseOwners(caseRow) : null) ??
        personName(request.requestedByAccountId) ??
        'Nobody assigned';
      const created = time(request.createdAt);
      // The traveller's time zone decides when the due day ends (ADR 0015 amendment).
      const timezone = request.applicantTimezone ?? caseRow?.applicantTimezone ?? null;

      if (group === 'MISSING' || group === 'NEEDS_CORRECTION') {
        if (!request.dueDate || daysUntilDue(request.dueDate, now, timezone) >= 0) continue;
        const sentBack = request.status === 'NEEDS_REPLACEMENT';
        // Received, but the newest version of the file failed its checks or is gone.
        const unusable = !sentBack && group === 'NEEDS_CORRECTION';
        const due = formatDateOnly(request.dueDate);
        ranked.push({
          primary: time(request.dueDate),
          created,
          item: {
            key: `request:${request.id}`,
            tier: 1,
            heading: label,
            traveller,
            caseTitle: caseRow?.title ?? null,
            owner,
            reason: sentBack
              ? `Sent back for a fix and was due ${due}. No new version yet.`
              : unusable
                ? `The file sent could not be used and it was due ${due}.`
                : `Was due ${due} and has not arrived.`,
            action: {
              kind: 'follow-up',
              label: 'Review Follow-Up Message',
              message: buildFollowUpMessage({
                travellerName: traveller,
                itemLabel: label,
                kind: request.kind,
                status: sentBack || unusable ? 'NEEDS_REPLACEMENT' : 'OPEN',
                dueDate: request.dueDate,
                caseTitle: caseRow?.title ?? null,
                agencyNote: request.message ?? null,
                requestReference: request.referenceCode ?? null,
                organizationName: input.organizationName,
                now,
                timezone,
              }),
            },
          },
        });
      } else if (group === 'RECEIVED') {
        // Processing is left out: a file still being checked is not ready for review yet.
        const when = request.respondedAt ? ` ${formatTimestampDate(request.respondedAt)}` : '';
        ranked.push({
          primary: 0,
          created,
          item: {
            key: `request:${request.id}`,
            tier: 2,
            heading: label,
            traveller,
            caseTitle: caseRow?.title ?? null,
            owner,
            reason:
              request.status === 'UNDER_REVIEW'
                ? 'Review started. Waiting for a decision.'
                : `Received${when} and waiting for review.`,
            action: {
              kind: 'link',
              label: 'Review Item',
              href: `${input.base}/clients#request-${request.id}`,
            },
          },
        });
      }
    }
  }

  // Rows 3 and 4: cases. Every case here is one this person can already see.
  for (const c of openCases) {
    const late = overdueTasks(c.tasks, now, c.applicantTimezone).sort(
      (a, b) => time(a.dueDate) - time(b.dueDate),
    );
    const oldest = late[0];
    const href = `${input.base}${CASE_ANCHOR}${c.missionId}`;
    if (oldest?.dueDate) {
      const count = late.length;
      ranked.push({
        primary: time(oldest.dueDate),
        created: time(c.createdAt),
        item: {
          key: `case:${c.missionId}`,
          tier: 3,
          heading: c.title,
          traveller: c.applicantName,
          caseTitle: c.title,
          owner: personName(oldest.assigneeAccountId) ?? caseOwners(c) ?? 'Nobody assigned',
          reason:
            count === 1
              ? `1 task is past due. It was due ${formatDateOnly(oldest.dueDate)}.`
              : `${count} tasks are past due. The oldest was due ${formatDateOnly(oldest.dueDate)}.`,
          action: { kind: 'link', label: 'Open Case', href },
        },
      });
    } else if (input.admin && c.assignments.length === 0) {
      ranked.push({
        primary: 0,
        created: time(c.createdAt),
        item: {
          key: `case:${c.missionId}`,
          tier: 4,
          heading: c.title,
          traveller: c.applicantName,
          caseTitle: c.title,
          owner: 'Nobody assigned',
          reason: 'Nobody is looking after this case yet.',
          action: { kind: 'link', label: 'Assign Someone', href },
        },
      });
    }
  }

  return ranked
    .sort(
      (a, b) =>
        a.item.tier - b.item.tier ||
        a.primary - b.primary ||
        a.created - b.created ||
        a.item.heading.localeCompare(b.item.heading, 'en') ||
        a.item.traveller.localeCompare(b.item.traveller, 'en') ||
        (a.item.key < b.item.key ? -1 : a.item.key > b.item.key ? 1 : 0),
    )
    .map((entry) => entry.item);
}
