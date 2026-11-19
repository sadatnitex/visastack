import { RecordBrowser } from '../../src/app/app/applicant/[id]/record-browser';
import {
  type RecordDocumentInput,
  buildRecordItems,
} from '../../src/app/app/applicant/[id]/record-hub';

/**
 * U6: the real All Records list on the real stylesheet, with made-up records: every state the
 * Record can say, a very long name, and enough items for a second page. Used by
 * e2e/wallet/u6-records.spec.ts.
 */
const person = '10000000-0000-4000-8000-000000000001';

const document = (id: number, name: string, overrides: Partial<RecordDocumentInput> = {}) =>
  ({
    id: `40000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
    name,
    typeLabel: 'Passport',
    typeKey: 'PASSPORT',
    groupLabel: 'Travel Documents',
    lifecycle: 'CURRENT',
    safetyStatus: 'CLEAN',
    processingStatus: 'AWAITING_REVIEW',
    checked: true,
    review: { expiryMissing: false, kindNeedsCheck: false, namePending: false },
    version: 2,
    updatedLabel: '12 Nov 2026',
    expiresLabel: '3 Mar 2031',
    expiryApplies: true,
    replacedBy: null,
    usedIn: ['Example Visit'],
    sharedWith: ['Example Agency'],
    ...overrides,
  }) satisfies RecordDocumentInput;

const LONG = 'A Very Long Example Document Name That Has To Wrap On A Small Phone Screen Properly';

const documents: RecordDocumentInput[] = [
  document(1, 'Example Passport'),
  document(2, LONG, { usedIn: [], sharedWith: [] }),
  document(3, 'Example Bank Letter', {
    typeLabel: 'Bank Letter',
    typeKey: 'BANK_LETTER',
    groupLabel: 'Money',
    processingStatus: 'REJECTED',
  }),
  document(4, 'Example Old Statement', {
    typeLabel: 'Bank Statement',
    typeKey: 'BANK_STATEMENT',
    groupLabel: 'Money',
    lifecycle: 'SUPERSEDED',
    replacedBy: { id: '40000000-0000-4000-8000-000000000009', name: 'Example New Statement' },
  }),
  document(5, 'Example Expired Permit', {
    typeLabel: 'Residence Permit',
    lifecycle: 'EXPIRED',
  }),
  document(6, 'Example Photo', {
    typeLabel: 'Photo',
    typeKey: 'PHOTO',
    checked: false,
    expiryApplies: false,
    expiresLabel: null,
  }),
  document(7, 'Example Unsorted File', {
    typeLabel: null,
    typeKey: null,
    review: { expiryMissing: false, kindNeedsCheck: true, namePending: false },
  }),
  ...Array.from({ length: 8 }, (_, index) => document(20 + index, `Example File ${index + 1}`)),
];

const items = buildRecordItems({
  applicantId: person,
  details: [
    { key: 'personal', label: 'About You', groupLabel: 'You', answered: 1, total: 4 },
    { key: 'contact', label: 'How to Reach You', groupLabel: 'You', answered: 4, total: 4 },
    { key: 'visas', label: 'Visas You Have Held', groupLabel: 'You', answered: 0, total: 3 },
  ],
  documents,
});

export default function U6RecordsFixture() {
  return (
    <div className="stack record-hub-page" id="top">
      <h1>All Records</h1>
      <RecordBrowser items={items} />
    </div>
  );
}
