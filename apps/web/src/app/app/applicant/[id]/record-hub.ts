/**
 * The Personal Record hub (WP-V3 part 2, v1.2 B03 / U01). Plain data and pure functions, so the
 * page and the tests read the same states and actions. The Record sections themselves live with
 * the navigation, in `lib/workspace-navigation.ts` (`recordSections`).
 *
 * Nothing here reads or grants access. Every action points at a page that already exists and
 * already checks who may use it: the record only gathers what the owner can already see.
 */

export type RecordTone = 'success' | 'warning' | 'danger' | 'neutral';
export type DocumentLifecycle = 'UNKNOWN' | 'CURRENT' | 'EXPIRING' | 'EXPIRED' | 'SUPERSEDED';

/** One document as the owner's own wallet already describes it. */
export interface RecordDocumentInput {
  readonly id: string;
  readonly name: string;
  /** The kind, in words, or null when no kind is set yet. */
  readonly typeLabel: string | null;
  /** The catalogue key of the kind, used to open the upload form for the same kind. */
  readonly typeKey: string | null;
  /** The category, in words, or null when the kind is not set. */
  readonly groupLabel: string | null;
  readonly lifecycle: DocumentLifecycle;
  readonly safetyStatus: string | null;
  readonly processingStatus: string | null;
  readonly version: number | null;
  readonly updatedLabel: string | null;
  readonly expiresLabel: string | null;
  /** The newer document that replaced this one, when there is one. */
  readonly replacedBy: { readonly id: string; readonly name: string } | null;
  readonly usedIn: readonly string[];
  readonly sharedWith: readonly string[];
}

/** One open profile section, with how many of its details are saved. */
export interface RecordDetailsInput {
  readonly key: string;
  readonly label: string;
  readonly groupLabel: string;
  readonly answered: number;
  readonly total: number;
}

export interface RecordAction {
  readonly label: string;
  readonly href: string;
}

export interface RecordItem {
  readonly id: string;
  readonly kind: 'details' | 'document';
  readonly group: string;
  readonly title: string;
  readonly type: string | null;
  readonly status: { readonly label: string; readonly tone: RecordTone };
  /** True only for a checked, current copy. Anything still being checked, refused, expired or replaced is false. */
  readonly usable: boolean;
  readonly needsAttention: boolean;
  readonly previousVersion: boolean;
  readonly facts: readonly string[];
  readonly actions: readonly RecordAction[];
  readonly searchText: string;
}

export const NOT_SORTED_GROUP = 'Kind Not Set Yet';

const PROBLEM_STATES = new Set(['REJECTED', 'FAILED', 'NEEDS_ATTENTION', 'QUARANTINED']);

/** What the record says about a document. Order matters: a problem outranks every date. */
export function documentState(
  doc: Pick<RecordDocumentInput, 'lifecycle' | 'safetyStatus' | 'processingStatus'>,
): Pick<RecordItem, 'status' | 'usable' | 'needsAttention' | 'previousVersion'> {
  if (doc.safetyStatus === 'QUARANTINED' || PROBLEM_STATES.has(doc.processingStatus ?? '')) {
    return {
      status: { label: 'Cannot Be Used', tone: 'danger' },
      usable: false,
      needsAttention: true,
      previousVersion: doc.lifecycle === 'SUPERSEDED',
    };
  }
  if (doc.processingStatus === 'AWAITING_REVIEW') {
    return {
      status: { label: 'Waiting for Your Review', tone: 'warning' },
      usable: false,
      needsAttention: true,
      previousVersion: doc.lifecycle === 'SUPERSEDED',
    };
  }
  if (doc.safetyStatus !== 'CLEAN' || doc.processingStatus !== 'APPROVED') {
    return {
      status: { label: 'Still Being Checked', tone: 'neutral' },
      usable: false,
      needsAttention: false,
      previousVersion: doc.lifecycle === 'SUPERSEDED',
    };
  }
  switch (doc.lifecycle) {
    case 'SUPERSEDED':
      return {
        status: { label: 'Previous Version', tone: 'neutral' },
        usable: false,
        needsAttention: false,
        previousVersion: true,
      };
    case 'EXPIRED':
      return {
        status: { label: 'Expired', tone: 'danger' },
        usable: false,
        needsAttention: true,
        previousVersion: false,
      };
    case 'EXPIRING':
      return {
        status: { label: 'Expiring Soon', tone: 'warning' },
        usable: true,
        needsAttention: true,
        previousVersion: false,
      };
    default:
      return {
        status: { label: 'Current Version', tone: 'success' },
        usable: true,
        needsAttention: false,
        previousVersion: false,
      };
  }
}

function documentItem(base: string, doc: RecordDocumentInput): RecordItem {
  const state = documentState(doc);
  const view = `${base}/documents?document=${encodeURIComponent(doc.id)}`;
  const replace = doc.typeKey
    ? `${base}/documents?type=${encodeURIComponent(doc.typeKey)}#document-upload`
    : `${base}/documents#document-upload`;
  const actions: RecordAction[] = [{ label: 'View', href: view }];
  // An old copy is kept for the record; the actions that would reuse it point at its replacement.
  if (state.previousVersion && doc.replacedBy) {
    actions.push({
      label: 'Open the Current Version',
      href: `${base}/documents?document=${encodeURIComponent(doc.replacedBy.id)}`,
    });
  } else if (!state.previousVersion) {
    actions.push({ label: 'Update or Replace', href: replace });
    if (state.usable) {
      actions.push({ label: 'Use in Case', href: `${base}/missions` });
      actions.push({ label: 'Share', href: `${base}/sharing` });
    }
  }
  const facts = [
    doc.version !== null ? `Version ${doc.version}` : null,
    doc.updatedLabel ? `Saved ${doc.updatedLabel}` : null,
    doc.expiresLabel ? `Expires ${doc.expiresLabel}` : 'Expiry not confirmed',
    doc.replacedBy ? `Replaced by ${doc.replacedBy.name}` : null,
    doc.usedIn.length ? `Used in ${doc.usedIn.join(', ')}` : 'Not used in a case yet',
    doc.sharedWith.length ? `Shared with ${doc.sharedWith.join(', ')}` : 'Not shared',
  ].filter((fact): fact is string => fact !== null);
  const group = doc.groupLabel ?? NOT_SORTED_GROUP;
  return {
    id: `document:${doc.id}`,
    kind: 'document',
    group,
    title: doc.name,
    type: doc.typeLabel,
    ...state,
    facts,
    actions,
    searchText: [doc.name, doc.typeLabel, group, state.status.label, ...facts]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase(),
  };
}

function detailsItem(base: string, section: RecordDetailsInput): RecordItem {
  const complete = section.total > 0 && section.answered >= section.total;
  const facts = [`${section.answered} of ${section.total} details saved`];
  return {
    id: `details:${section.key}`,
    kind: 'details',
    group: section.groupLabel,
    title: section.label,
    type: null,
    status: complete
      ? { label: 'All Details Saved', tone: 'success' }
      : section.answered > 0
        ? { label: 'Partly Filled In', tone: 'neutral' }
        : { label: 'Nothing Saved Yet', tone: 'neutral' },
    usable: false,
    needsAttention: false,
    previousVersion: false,
    facts,
    actions: [
      {
        label: 'View or Update',
        href: `${base}/profile#section-${encodeURIComponent(section.key)}`,
      },
      { label: 'Use in Case', href: `${base}/missions` },
    ],
    searchText: [section.label, section.groupLabel, ...facts].join(' ').toLocaleLowerCase(),
  };
}

/** The whole record for one person: profile sections first, then documents, newest kept beside older ones. */
export function buildRecordItems(input: {
  readonly applicantId: string;
  readonly details: readonly RecordDetailsInput[];
  readonly documents: readonly RecordDocumentInput[];
}): readonly RecordItem[] {
  const base = `/app/applicant/${input.applicantId}`;
  return [
    ...input.details.map((section) => detailsItem(base, section)),
    ...input.documents.map((doc) => documentItem(base, doc)),
  ];
}

export type RecordFilter = 'all' | 'details' | 'ready' | 'attention' | 'previous';

export const RECORD_FILTERS: readonly { readonly key: RecordFilter; readonly label: string }[] = [
  { key: 'all', label: 'Everything' },
  { key: 'details', label: 'Profile Details' },
  { key: 'ready', label: 'Ready to Use' },
  { key: 'attention', label: 'Needs Attention' },
  { key: 'previous', label: 'Previous Versions' },
];

/** Metadata search only: names, kinds, groups, states and the facts shown. File contents are never searched. */
export function filterRecordItems(
  items: readonly RecordItem[],
  options: { readonly query: string; readonly group: string; readonly filter: RecordFilter },
): readonly RecordItem[] {
  const words = options.query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return items.filter(
    (item) =>
      (options.group === 'all' || item.group === options.group) &&
      (options.filter === 'all' ||
        (options.filter === 'details'
          ? item.kind === 'details'
          : options.filter === 'ready'
            ? item.usable
            : options.filter === 'attention'
              ? item.needsAttention
              : item.previousVersion)) &&
      words.every((word) => item.searchText.includes(word)),
  );
}
