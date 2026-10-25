import { describe, expect, it } from 'vitest';
import { recordSections } from '../../../../lib/workspace-navigation';
import {
  type RecordDocumentInput,
  buildRecordItems,
  documentState,
  filterRecordItems,
  layoutRecordPage,
  recordFilterCount,
} from './record-hub';

const person = '10000000-0000-4000-8000-000000000001';
const base = `/app/applicant/${person}`;

function doc(overrides: Partial<RecordDocumentInput> = {}): RecordDocumentInput {
  return {
    id: '40000000-0000-4000-8000-000000000001',
    name: 'Synthetic Passport',
    typeLabel: 'Passport',
    typeKey: 'passport',
    groupLabel: 'Identity',
    lifecycle: 'CURRENT',
    safetyStatus: 'CLEAN',
    // The pipeline's normal finished state; nothing in production sets APPROVED today.
    processingStatus: 'AWAITING_REVIEW',
    checked: true,
    review: { expiryMissing: false, kindNeedsCheck: false, namePending: false },
    version: 2,
    updatedLabel: '1 Oct 2026',
    expiresLabel: '1 Oct 2030',
    expiryApplies: true,
    replacedBy: null,
    usedIn: [],
    sharedWith: [],
    ...overrides,
  };
}

const build = (documents: readonly RecordDocumentInput[]) =>
  buildRecordItems({
    applicantId: person,
    details: [
      { key: 'employment', label: 'Employment', groupLabel: 'Work', answered: 2, total: 5 },
    ],
    documents,
  });

describe('Record sections', () => {
  it('are the hub and the four existing pages that used to be separate destinations', () => {
    expect(recordSections(person).map((section) => section.href)).toEqual([
      `${base}/record`,
      `${base}/profile`,
      `${base}/documents`,
      `${base}/expiry`,
      `${base}/history`,
    ]);
  });
});

describe('document state never overstates what a file can be used for', () => {
  it('a scanned, finished copy is ready to use, as Cases and downloads treat it', () => {
    expect(documentState(doc()).usable).toBe(true);
    expect(documentState(doc()).status.label).toBe('Current Version');
    expect(documentState(doc({ processingStatus: 'APPROVED' })).usable).toBe(true);
    expect(documentState(doc({ lifecycle: 'EXPIRING' })).usable).toBe(true);
    expect(documentState(doc({ lifecycle: 'UNKNOWN' })).status.label).toBe('Current Version');
  });

  it.each([
    ['refused', { processingStatus: 'REJECTED' }, 'Cannot Be Used'],
    ['failed', { processingStatus: 'FAILED' }, 'Cannot Be Used'],
    ['held back by the safety check', { safetyStatus: 'QUARANTINED' }, 'Cannot Be Used'],
    ['whose scan failed', { safetyStatus: 'FAILED' }, 'Cannot Be Used'],
    ['not yet scanned', { safetyStatus: 'PENDING', checked: false }, 'Still Being Checked'],
    ['still being read', { processingStatus: 'EXTRACTING', checked: false }, 'Still Being Checked'],
    ['expired', { lifecycle: 'EXPIRED' }, 'Expired'],
    ['replaced', { lifecycle: 'SUPERSEDED' }, 'Previous Version'],
    [
      'passport with no expiry date',
      { review: { expiryMissing: true, kindNeedsCheck: false, namePending: false } },
      'Needs Your Check',
    ],
    [
      'kind waiting for a check',
      { review: { expiryMissing: false, kindNeedsCheck: true, namePending: false } },
      'Needs Your Check',
    ],
    [
      'new name waiting for a decision',
      { review: { expiryMissing: false, kindNeedsCheck: false, namePending: true } },
      'Needs Your Check',
    ],
  ] as const)('a %s file is not ready to use', (_name, overrides, label) => {
    const state = documentState(doc(overrides as Partial<RecordDocumentInput>));
    expect(state.usable).toBe(false);
    expect(state.status.label).toBe(label);
  });

  it('checks in order: problem, then expired or replaced, then still being checked, then review', () => {
    const review = { expiryMissing: false, kindNeedsCheck: true, namePending: false };
    expect(
      documentState(doc({ processingStatus: 'REJECTED', lifecycle: 'EXPIRED' })).status.label,
    ).toBe('Cannot Be Used');
    // An expired passport shows Expired, even while its kind also waits for a check.
    expect(documentState(doc({ lifecycle: 'EXPIRED', review })).status.label).toBe('Expired');
    // A replaced copy shows Previous Version, even while it is still being checked.
    expect(documentState(doc({ lifecycle: 'SUPERSEDED', checked: false })).status.label).toBe(
      'Previous Version',
    );
    expect(documentState(doc({ checked: false, review })).status.label).toBe('Still Being Checked');
  });

  it('the review reasons are shown on the record', () => {
    const [, item] = build([
      doc({ review: { expiryMissing: true, kindNeedsCheck: true, namePending: true } }),
    ]);
    expect(item?.facts.slice(0, 3)).toEqual([
      'Expiry date not set',
      'Kind needs your check',
      'New name waiting for your decision',
    ]);
    expect(item?.needsAttention).toBe(true);
  });
});

describe('each item: its title opens it, and at most one further action', () => {
  const view = `${base}/documents?document=40000000-0000-4000-8000-000000000001`;

  it('a ready document opens its page from the title and offers Share for that document', () => {
    const [, item] = build([doc()]);
    expect(item?.href).toBe(view);
    expect(item?.action).toEqual({
      label: 'Share',
      href: `${base}/sharing?document=40000000-0000-4000-8000-000000000001#new-sharing-request`,
    });
  });

  it('a document that is not ready offers Update or Replace, never Share', () => {
    for (const overrides of [
      { processingStatus: 'REJECTED' },
      { checked: false },
      { lifecycle: 'EXPIRED' as const },
      { review: { expiryMissing: true, kindNeedsCheck: false, namePending: false } },
    ]) {
      const [, item] = build([doc(overrides as Partial<RecordDocumentInput>)]);
      expect(item?.action).toEqual({
        label: 'Update or Replace',
        href: `${base}/documents?type=passport#document-upload`,
      });
    }
  });

  it('a previous version points at its replacement instead of being reused', () => {
    const replacedBy = { id: '40000000-0000-4000-8000-000000000002', name: 'Synthetic Passport 2' };
    const [, item] = build([doc({ lifecycle: 'SUPERSEDED', replacedBy })]);
    expect(item?.previousVersion).toBe(true);
    expect(item?.action).toEqual({
      label: 'Open the Current Version',
      href: `${base}/documents?document=40000000-0000-4000-8000-000000000002`,
    });
    expect(item?.facts).toContain('Replaced by Synthetic Passport 2');
    expect(build([doc({ lifecycle: 'SUPERSEDED' })])[1]?.action).toBeNull();
  });

  it('a profile section opens its own place in the profile', () => {
    const [item] = build([]);
    expect(item?.href).toBe(`${base}/profile#section-employment`);
    expect(item?.facts).toEqual(['2 of 5 details saved']);
  });

  it('Go to Cases is offered for a profile section only once it holds a saved answer', () => {
    const items = buildRecordItems({
      applicantId: person,
      details: [
        { key: 'education', label: 'Education', groupLabel: 'Study', answered: 0, total: 3 },
      ],
      documents: [],
    });
    expect(items[0]?.action).toBeNull();
    expect(build([])[0]?.action).toEqual({ label: 'Go to Cases', href: `${base}/missions` });
  });

  it('a document without a kind falls back to the upload form and its own group', () => {
    const [, item] = build([
      doc({ typeKey: null, typeLabel: null, groupLabel: '', checked: false }),
    ]);
    expect(item?.group).toBe('Other Documents');
    expect(item?.action?.href).toBe(`${base}/documents#document-upload`);
  });
});

describe('metadata search and filters', () => {
  const items = build([
    doc({ usedIn: ['Synthetic UK Visit'] }),
    doc({
      id: '40000000-0000-4000-8000-000000000003',
      name: 'Old Synthetic Passport',
      lifecycle: 'SUPERSEDED',
      version: 1,
    }),
    doc({
      id: '40000000-0000-4000-8000-000000000004',
      name: 'Synthetic Payslip',
      typeLabel: 'Payslip',
      typeKey: 'payslip',
      groupLabel: 'Work',
      lifecycle: 'EXPIRED',
    }),
  ]);
  const titles = (query: string, group = 'all', filter = 'all' as const) =>
    filterRecordItems(items, { query, group, filter }).map((item) => item.title);

  it('finds a current passport and its previous version by kind', () => {
    expect(titles('passport')).toEqual(['Synthetic Passport', 'Old Synthetic Passport']);
    expect(
      filterRecordItems(items, { query: 'passport', group: 'all', filter: 'previous' }).map(
        (item) => item.title,
      ),
    ).toEqual(['Old Synthetic Passport']);
  });

  it('matches every word, across case names and groups', () => {
    expect(titles('uk visit')).toEqual(['Synthetic Passport']);
    expect(titles('', 'Work')).toEqual(['Employment', 'Synthetic Payslip']);
    expect(titles('nothing like this')).toEqual([]);
  });

  it('ready and attention filters follow the document state', () => {
    const by = (filter: 'ready' | 'attention' | 'details') =>
      filterRecordItems(items, { query: '', group: 'all', filter }).map((item) => item.title);
    expect(by('ready')).toEqual(['Synthetic Passport']);
    expect(by('attention')).toEqual(['Synthetic Payslip']);
    expect(by('details')).toEqual(['Employment']);
  });
});

describe('expiry facts', () => {
  it('a kind with an end date says when it ends, or that the date is not confirmed', () => {
    expect(build([doc()])[1]?.facts).toContain('Expires 1 Oct 2030');
    expect(build([doc({ expiresLabel: null })])[1]?.facts).toContain('Expiry not confirmed');
  });
  it('a kind without one says nothing about expiry', () => {
    const facts = build([doc({ expiresLabel: null, expiryApplies: false })])[1]?.facts ?? [];
    expect(facts.some((fact) => /expir/i.test(fact))).toBe(false);
  });
});

describe('empty profile sections do not crowd documents off the page', () => {
  const empties = Array.from({ length: 9 }, (_, index) => ({
    key: `empty_${index}`,
    label: `Empty Section ${index + 1}`,
    groupLabel: index < 5 ? 'Identity' : 'Money',
    answered: 0,
    total: 3,
  }));
  const documents = Array.from({ length: 5 }, (_, index) =>
    doc({
      id: `40000000-0000-4000-8000-00000000010${index}`,
      name: `Synthetic Document ${index + 1}`,
      groupLabel: index < 3 ? 'Identity' : 'Money',
    }),
  );
  const items = buildRecordItems({
    applicantId: person,
    details: [
      { key: 'saved', label: 'Saved Section', groupLabel: 'Identity', answered: 2, total: 3 },
      ...empties,
    ],
    documents,
  });
  const all = filterRecordItems(items, { query: '', group: 'all', filter: 'all' });

  it('every document and saved section fits on page one; empty sections are not rows or counted', () => {
    const layout = layoutRecordPage(all, { filter: 'all', page: 0, pageSize: 5 });
    expect(layout.rowCount).toBe(6);
    expect(layout.pageCount).toBe(2);
    const page = layout.groups.flatMap((group) => group.rows.map((item) => item.title));
    expect(page).not.toContain('Empty Section 1');
    expect(page).toEqual([
      'Saved Section',
      'Synthetic Document 1',
      'Synthetic Document 2',
      'Synthetic Document 3',
      'Synthetic Document 4',
    ]);
    expect(recordFilterCount(items, 'all')).toBe(6);
  });

  it("names a group's empty sections once, at its end, on the page with its last row", () => {
    const first = layoutRecordPage(all, { filter: 'all', page: 0, pageSize: 5 });
    const second = layoutRecordPage(all, { filter: 'all', page: 1, pageSize: 5 });
    const named = (layout: typeof first, name: string) =>
      layout.groups.find((group) => group.name === name)?.nothingSaved.map((item) => item.title);
    expect(named(first, 'Identity')).toHaveLength(5);
    expect(named(first, 'Money')).toEqual([]);
    expect(named(second, 'Money')).toEqual([
      'Empty Section 6',
      'Empty Section 7',
      'Empty Section 8',
      'Empty Section 9',
    ]);
    expect(named(second, 'Identity')).toBeUndefined();
  });

  it('the Profile Details filter still lists every open section as a row', () => {
    const details = filterRecordItems(items, { query: '', group: 'all', filter: 'details' });
    const layout = layoutRecordPage(details, { filter: 'details', page: 0, pageSize: 12 });
    expect(layout.rowCount).toBe(10);
    expect(layout.groups.every((group) => group.nothingSaved.length === 0)).toBe(true);
    expect(recordFilterCount(items, 'details')).toBe(10);
  });
});
