import { describe, expect, it } from 'vitest';
import { recordSections } from '../../../../lib/workspace-navigation';
import {
  type RecordDocumentInput,
  buildRecordItems,
  documentState,
  filterRecordItems,
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
    processingStatus: 'APPROVED',
    version: 2,
    updatedLabel: '1 Oct 2026',
    expiresLabel: '1 Oct 2030',
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
  it('only a checked, current copy is ready to use', () => {
    expect(documentState(doc()).usable).toBe(true);
    expect(documentState(doc({ lifecycle: 'EXPIRING' })).usable).toBe(true);
    expect(documentState(doc({ lifecycle: 'UNKNOWN' })).status.label).toBe('Current Version');
  });

  it.each([
    ['refused', { processingStatus: 'REJECTED' }, 'Cannot Be Used'],
    ['failed', { processingStatus: 'FAILED' }, 'Cannot Be Used'],
    ['held back by the safety check', { safetyStatus: 'QUARANTINED' }, 'Cannot Be Used'],
    ['still being checked', { processingStatus: 'EXTRACTING' }, 'Still Being Checked'],
    ['not yet scanned', { safetyStatus: 'PENDING' }, 'Still Being Checked'],
    ['waiting for review', { processingStatus: 'AWAITING_REVIEW' }, 'Waiting for Your Review'],
    ['expired', { lifecycle: 'EXPIRED' }, 'Expired'],
    ['replaced', { lifecycle: 'SUPERSEDED' }, 'Previous Version'],
  ] as const)('a %s file is not ready to use', (_name, overrides, label) => {
    const state = documentState(doc(overrides as Partial<RecordDocumentInput>));
    expect(state.usable).toBe(false);
    expect(state.status.label).toBe(label);
  });

  it('a problem outranks a good expiry date', () => {
    expect(documentState(doc({ processingStatus: 'REJECTED', lifecycle: 'CURRENT' })).usable).toBe(
      false,
    );
  });
});

describe('actions point only at existing pages', () => {
  it('a ready document offers View, Update or Replace, Use in Case and Share', () => {
    const [, item] = build([doc()]);
    expect(item?.actions).toEqual([
      { label: 'View', href: `${base}/documents?document=40000000-0000-4000-8000-000000000001` },
      { label: 'Update or Replace', href: `${base}/documents?type=passport#document-upload` },
      { label: 'Use in Case', href: `${base}/missions` },
      { label: 'Share', href: `${base}/sharing` },
    ]);
  });

  it('a file that cannot be used is never offered for a case or for sharing', () => {
    const [, item] = build([doc({ processingStatus: 'REJECTED' })]);
    expect(item?.actions.map((action) => action.label)).toEqual(['View', 'Update or Replace']);
  });

  it('a previous version points at its replacement instead of being reused', () => {
    const [, item] = build([
      doc({
        lifecycle: 'SUPERSEDED',
        replacedBy: { id: '40000000-0000-4000-8000-000000000002', name: 'Synthetic Passport 2' },
      }),
    ]);
    expect(item?.previousVersion).toBe(true);
    expect(item?.actions.map((action) => action.label)).toEqual([
      'View',
      'Open the Current Version',
    ]);
    expect(item?.facts).toContain('Replaced by Synthetic Passport 2');
  });

  it('a profile section opens its own place in the profile', () => {
    const [item] = build([]);
    expect(item?.actions[0]).toEqual({
      label: 'View or Update',
      href: `${base}/profile#section-employment`,
    });
    expect(item?.facts).toEqual(['2 of 5 details saved']);
  });

  it('a document without a kind falls back to the upload form and its own group', () => {
    const [, item] = build([doc({ typeKey: null, typeLabel: null, groupLabel: null })]);
    expect(item?.group).toBe('Kind Not Set Yet');
    expect(item?.actions[1]?.href).toBe(`${base}/documents#document-upload`);
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
