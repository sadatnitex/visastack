import {
  type RequirementCategory,
  type RequirementNecessity,
  type RequirementProvenance,
  requirementCategoryOrder,
} from '@visastack/core';
import { CATALOGUE_DOCUMENTS } from '@visastack/core/catalogue';
import type {
  NoPackReason,
  OverallReadinessState,
  RequirementResultState,
} from '@visastack/services';
import type { IconName } from '../../../../components/icons';
import type { RowNoun } from '../../../../components/show-more';
import type { LiftTone } from '../../../../components/ui-lift';
import type { SelectableChecklists } from '../../../../lib/case-checklist-match';
import { humanizeCode } from '../../../../lib/format-code';
import { fieldLabel } from '../../../../lib/master-profile';
import { TRAVELLER_LIST_STEP } from '../../../../lib/paging';
import { REQUIREMENT_GROUPS } from '../../../../lib/requirement-groups';
import type { WelcomeChecklists } from './case-welcome-copy';

/**
 * What the case page works out once and its parts show. Pure values and helpers only: no data is
 * read here and nothing here renders. The page loads, derives and composes; the case parts
 * (status panel, checklist, rail, secondary sections, mobile bar) take plain props.
 */

/** The value inside a successful service result. */
export type OkValue<R> = R extends { readonly ok: true; readonly value: infer V } ? V : never;

// RUL-04's four case-level outcomes (directive §10 case-readiness experience),
// never averaged from the per-requirement states below.
export const OVERALL_STATE_META: Record<OverallReadinessState, { label: string; tone: string }> = {
  READY_FOR_APPLICANT_REVIEW: { label: 'Ready for Review', tone: 'badge-success' },
  NEEDS_REVIEW: { label: 'Needs Review', tone: 'badge-warning' },
  NEEDS_ACTION: { label: 'Needs Action', tone: 'badge-danger' },
  MANUAL_ONLY: { label: 'Manual · Not Automatically Assessed', tone: 'badge-neutral' },
};

// RUL-04's seven per-requirement outcomes. Sort order surfaces what still
// needs a decision first; NOT_APPLICABLE trails last since it needs none.
export const REQUIREMENT_STATE_META: Record<
  RequirementResultState,
  { label: string; tone: string; next: string; order: number }
> = {
  CRITICAL_GAP: {
    label: 'Missing',
    tone: 'badge-danger',
    next: 'Add this to move the case forward.',
    order: 0,
  },
  CONFLICTING: {
    label: 'Two Values',
    tone: 'badge-danger',
    next: 'Two different values are on file. Pick the right one on your profile before it can count.',
    order: 1,
  },
  EXPIRING_STALE: {
    label: 'Out of Date',
    tone: 'badge-danger',
    next: 'The evidence on file is too old for this route. Add a current version.',
    order: 2,
  },
  UNVERIFIED: {
    label: 'To Confirm',
    tone: 'badge-warning',
    next: 'Whether this applies depends on case details that are not confirmed yet.',
    order: 3,
  },
  ATTENTION: {
    label: 'Optional',
    tone: 'badge-neutral',
    next: 'Optional for this case.',
    order: 4,
  },
  SATISFIED: { label: 'On File', tone: 'badge-success', next: '', order: 5 },
  NOT_APPLICABLE: {
    label: 'Not Applicable',
    tone: 'badge-neutral',
    next: 'Does not apply to this case.',
    order: 6,
  },
};

export type AttentionKind = 'changed' | 'missing' | 'unconfirmed' | 'expiry' | 'trip' | 'tasks';

/** How many snapshots the case page lists; the rest are one link away (WP-SB2). */
export const SNAPSHOTS_ON_PAGE = 5;

/** Rows a checklist group shows before the rest fold under Show All (WP-SB2). */
export const CHECKLIST_ROWS_SHOWN = 3;

/**
 * The case page's capped lists (WP-SB2): each shows 10 rows, then Show More asks the server for
 * 10 more through its own address parameter, so opening one list never resets another.
 */
export const CAPPED_LISTS = {
  tasks: { noun: { one: 'task', other: 'tasks' }, rowId: 'case-task' },
  notes: { noun: { one: 'note', other: 'notes' }, rowId: 'case-note' },
  outcomes: { noun: { one: 'outcome', other: 'outcomes' }, rowId: 'case-outcome' },
  complaints: { noun: { one: 'complaint', other: 'complaints' }, rowId: 'case-complaint' },
  feedback: { noun: { one: 'feedback note', other: 'feedback notes' }, rowId: 'case-feedback' },
} as const satisfies Record<string, { readonly noun: RowNoun; readonly rowId: string }>;

export type CappedList = keyof typeof CAPPED_LISTS;

export const LIST_STEP = { step: TRAVELLER_LIST_STEP } as const;

/** The checklist groups' ids are `<prefix>-<heading in lower case with hyphens>`. */
export const CHECKLIST_ID_PREFIX = 'case-checklist';

/** How long after it is made a case still opens with its welcome note. */
const WELCOME_WINDOW_MS = 60 * 60 * 1000;

/** Whether a case was made recently enough to open with its welcome note. */
export function madeJustNow(createdAt: Date | string): boolean {
  return Date.now() - new Date(createdAt).getTime() < WELCOME_WINDOW_MS;
}

/**
 * For the welcome note of a case with no checklist: whether reviewed checklists fit its country
 * and purpose and may cover its traveller, worked out once for the picker (`choices`). A case that
 * names no country or no purpose has no route to narrow by, so it is offered the picker when any
 * checklist may be picked. Reviewed checklists that do not fit but exist are `none` with the
 * reason (`reasons`); an agency's own checklist still offers the picker. A failed check is
 * `unknown`, never a guess.
 */
export function welcomeChecklists(
  choices: SelectableChecklists,
  reasons: readonly NoPackReason[],
): WelcomeChecklists {
  if (choices.lookupFailed) return { kind: 'unknown' };
  const { fitting } = choices;
  if (fitting === null) {
    return choices.options.length > 0
      ? { kind: 'pick', travellerUnconfirmed: false }
      : { kind: 'none' };
  }
  if (fitting.length === 0) {
    return choices.options.length > 0
      ? { kind: 'pick', travellerUnconfirmed: false }
      : { kind: 'none', reasons };
  }
  const caseDetailsNeeded = [...new Set(fitting.flatMap((checklist) => checklist.needs ?? []))];
  return {
    kind: 'pick',
    travellerUnconfirmed: fitting.some((checklist) => !checklist.coversTraveller),
    ...(caseDetailsNeeded.length > 0 ? { caseDetailsNeeded } : {}),
  };
}

export const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

/** The tone a badge class name carries ("badge-danger" is "danger"). */
export const toneOfBadge = (badge: string): LiftTone => {
  const tone = badge.replace('badge-', '');
  return tone === 'success' || tone === 'warning' || tone === 'danger' || tone === 'info'
    ? tone
    : 'neutral';
};

/**
 * The sentence under the overall state, said plainly for a count of one or many. The shared
 * message reads "{count} requirement(s) still needed"; this words it as the rest of the page does
 * ("1 required item still needed"). Any other sentence, in any language, passes through unchanged.
 */
export function plainRequirementCount(sentence: string, count: number): string {
  const one = count === 1;
  return sentence
    .replace('requirement(s) need', one ? 'required item needs' : 'required items need')
    .replace('requirement(s)', one ? 'required item' : 'required items');
}

/** The mark each attention chip carries: a cross for what blocks, a triangle for what to check. */
export const ATTENTION_ICON: Record<'warning' | 'danger', IconName> = {
  danger: 'close',
  warning: 'alert',
};

/** The tone of each checklist group: what needs you, what needs a check, what is done. */
export const CHECKLIST_GROUP_TONE: Readonly<Record<string, 'danger' | 'warning' | 'success'>> = {
  'needs-you': 'danger',
  'needs-a-check': 'warning',
  done: 'success',
};

/** How far one checklist category is: the items on file, out of the items that count. */
export interface CategoryProgress {
  readonly onFile: number;
  readonly total: number;
}

/**
 * Per category across the whole checklist, not only inside one group: an item that does not apply,
 * or that another alternative already covers, is not counted, so "on file" is never short of a
 * total the person cannot reach.
 */
export function categoryProgress(
  rows: readonly RequirementDetailRow[],
): ReadonlyMap<string, CategoryProgress> {
  const progress = new Map<string, CategoryProgress>();
  for (const r of rows) {
    if (r.state === 'NOT_APPLICABLE' || r.coveredByAlternative) continue;
    const key = r.category ?? 'other';
    const seen = progress.get(key) ?? { onFile: 0, total: 0 };
    progress.set(key, {
      onFile: seen.onFile + (r.state === 'SATISFIED' ? 1 : 0),
      total: seen.total + 1,
    });
  }
  return progress;
}

// WP-X1 next step card: wording for the first attention item. A changed case
// is shown by its own alert instead, so it has no card wording.
// CCD section 6: it speaks of this case by its name, and names the first item to fix.
export const NEXT_STEP_COPY: Record<
  Exclude<AttentionKind, 'changed'>,
  {
    readonly title: (count: number, caseTitle: string) => string;
    /** The one short line shown under the title (the first item to deal with); null when none. */
    readonly lead: (firstItem: string | null) => string | null;
    /** The longer reason, folded under "Why This Step". */
    readonly why: string;
    /** The short count for the phone bar ("4 to fix"). */
    readonly short: (count: number) => string;
    readonly action: string;
  }
> = {
  // Counts missing, out-of-date and mismatched required items together.
  missing: {
    title: (count, caseTitle) =>
      `Fix ${plural(count, 'required item', 'required items')} for ${caseTitle}`,
    lead: (firstItem) => (firstItem ? `First to fix: ${firstItem}.` : null),
    why: 'Some required items are missing, out of date or do not match.',
    short: (count) => `${count} to fix`,
    action: 'See What Needs Fixing',
  },
  unconfirmed: {
    title: (count, caseTitle) => `Confirm ${plural(count, 'item', 'items')} for ${caseTitle}`,
    lead: () => null,
    why: 'Whether these apply depends on case details that are not confirmed yet.',
    short: (count) => `${count} to confirm`,
    action: 'See What to Confirm',
  },
  // UMPE G2 (R22): one item for every chosen document that will not last this trip.
  expiry: {
    title: (count, caseTitle) =>
      `Replace ${plural(count, 'document', 'documents')} that ${count === 1 ? 'expires' : 'expire'} before ${caseTitle} ends`,
    lead: (firstItem) => (firstItem ? `First to replace: ${firstItem}.` : null),
    why: 'A chosen document must stay valid until your trip ends, and longer when this checklist says so. Renew it or choose another copy.',
    short: (count) => `${count} expiring`,
    action: 'See Which Documents',
  },
  trip: {
    title: (count, caseTitle) => `Check ${plural(count, 'date', 'dates')} for ${caseTitle}`,
    lead: () => null,
    why: 'Open Trip Date Checks to see which dates do not line up with your passport, insurance or plans.',
    short: (count) => `${count} to check`,
    action: 'See Trip Date Checks',
  },
  tasks: {
    title: (count, caseTitle) =>
      `Finish ${plural(count, 'open task', 'open tasks')} for ${caseTitle}`,
    lead: () => null,
    why: 'Your open tasks are listed under Tasks, appointments and letters.',
    short: (count) => `${count} open`,
    action: 'Open Tasks',
  },
};

/** A checklist item's name, as the checklist shows it. */
export const requirementLabel = (r: {
  readonly kind: 'FIELD' | 'DOCUMENT';
  readonly key: string;
}) => (r.kind === 'FIELD' ? (fieldLabel(r.key) ?? humanizeCode(r.key)) : humanizeCode(r.key));

export interface RequirementDetailRow {
  readonly packRequirementId: string;
  readonly kind: 'FIELD' | 'DOCUMENT';
  readonly key: string;
  readonly optional: boolean;
  readonly state: RequirementResultState;
  readonly citation: string;
  readonly sourceTitle: string | null;
  readonly sourceUrl: string | null;
  readonly publisher: string | null;
  readonly observedDate: string | null;
  readonly sourceInaccessible: boolean;
  /** UMPE P1: present only when authored; a legacy requirement shows exactly what it did. */
  readonly necessity?: RequirementNecessity;
  readonly provenance?: RequirementProvenance;
  readonly groupKey?: string;
  readonly coveredByAlternative?: true;
  /** UMPE G2 (R02): the rule category, when the checklist gives one. */
  readonly category: RequirementCategory | null;
}

/** UMPE G2 (R08): one cited source, with when it was last checked and when its rule took effect. */
export interface CaseSourceRow {
  readonly href: string;
  readonly name: string;
  readonly checkedAt: string | null;
  readonly inEffectSince: string | null;
}

/** UMPE G2 (R22): a chosen document that will not last the trip, as the page lists it. */
export interface ExpiringDocumentRow {
  readonly documentId: string;
  readonly name: string;
  readonly expiresAt: string;
  readonly neededUntil: string;
}

/** UMPE P12: catalogue document kinds for "The Embassy Asked for More", by name. */
export const ATTEMPT_DOCUMENT_KINDS = CATALOGUE_DOCUMENTS.map((d) => ({
  value: d.key,
  label: d.label,
})).sort((a, b) => a.label.localeCompare(b.label));

/** One line of the "what needs attention" list; the first is the next step. */
export interface CaseAttentionItem {
  readonly kind: AttentionKind;
  readonly label: string;
  readonly href: string;
  readonly count: number;
  readonly tone: 'warning' | 'danger';
  /** The id of a checklist group the link opens, which then shows the rows it counts. */
  readonly opens?: string;
}

/** The counts the attention list is worked out from. */
export interface CaseAttentionInput {
  readonly isDirty: boolean;
  /** Whether the case has a checklist at all (readiness was computed). */
  readonly hasReadiness: boolean;
  /** Whether the checklist has rows to open a group on. */
  readonly hasChecklist: boolean;
  readonly requiredHardGapCount: number;
  readonly requiredUnverifiedCount: number;
  readonly expiringDocumentCount: number;
  readonly tripChecksToAct: number;
  readonly openTasks: number;
}

/** The attention list, most urgent first; empty when nothing needs a person. */
export function buildCaseAttention(input: CaseAttentionInput): readonly CaseAttentionItem[] {
  const {
    isDirty,
    hasReadiness,
    hasChecklist,
    requiredHardGapCount,
    requiredUnverifiedCount,
    expiringDocumentCount,
    tripChecksToAct,
    openTasks,
  } = input;
  return [
    ...(isDirty
      ? [
          {
            kind: 'changed' as const,
            label: 'changed since confirmed',
            href: '#snapshots',
            count: 1,
            tone: 'danger' as const,
          },
        ]
      : []),
    ...(hasReadiness && requiredHardGapCount > 0
      ? [
          {
            kind: 'missing' as const,
            // Owner, 4 Nov 2026: "to fix" counts what the Next Step and the checklist count.
            label: requiredHardGapCount === 1 ? 'required item to fix' : 'required items to fix',
            href: '#readiness',
            count: requiredHardGapCount,
            tone: 'danger' as const,
          },
        ]
      : []),
    ...(hasReadiness && requiredUnverifiedCount > 0
      ? [
          {
            kind: 'unconfirmed' as const,
            label: 'need a check',
            href: '#readiness',
            // The group this link opens when followed (WP-SB2).
            ...(hasChecklist ? { opens: `${CHECKLIST_ID_PREFIX}-needs-a-check` } : {}),
            count: requiredUnverifiedCount,
            tone: 'warning' as const,
          },
        ]
      : []),
    ...(expiringDocumentCount > 0
      ? [
          {
            kind: 'expiry' as const,
            label:
              expiringDocumentCount === 1
                ? 'document expires before the trip ends'
                : 'documents expire before the trip ends',
            href: '#expiring-documents',
            count: expiringDocumentCount,
            tone: 'danger' as const,
          },
        ]
      : []),
    ...(tripChecksToAct > 0
      ? [
          {
            kind: 'trip' as const,
            label: tripChecksToAct === 1 ? 'date to check' : 'dates to check',
            href: '#trip-checks',
            count: tripChecksToAct,
            tone: 'warning' as const,
          },
        ]
      : []),
    ...(openTasks > 0
      ? [
          {
            kind: 'tasks' as const,
            label: openTasks === 1 ? 'open task' : 'open tasks',
            href: '#work',
            count: openTasks,
            tone: 'warning' as const,
          },
        ]
      : []),
  ];
}

/** One checklist group (Needs You, Needs a Check, Done): its id key, heading and rows. */
export interface ChecklistGroup {
  readonly key: string;
  readonly heading: string;
  readonly rows: readonly RequirementDetailRow[];
}

/** The checklist's groups that have rows, in their fixed order (WP-SB2). */
export function buildChecklistGroups(
  requirementDetails: readonly RequirementDetailRow[],
): readonly ChecklistGroup[] {
  return REQUIREMENT_GROUPS.flatMap((group) => {
    const rows = requirementDetails
      .filter((r) => group.states.includes(r.state))
      // UMPE G2 (R02): rule categories, in their fixed order, inside each group (a stable sort, so
      // a checklist with no categories keeps exactly its old order).
      .map((r, index) => ({ r, index }))
      .sort(
        (a, b) =>
          requirementCategoryOrder(a.r.category) - requirementCategoryOrder(b.r.category) ||
          a.index - b.index,
      )
      .map(({ r }) => r);
    return rows.length === 0
      ? []
      : [{ key: group.heading.toLowerCase().replace(/\s+/g, '-'), heading: group.heading, rows }];
  });
}
