import { describe, expect, it } from 'vitest';
import { appApplicantCatalog } from '../../../../../i18n/app-applicant';
import { buildRecordItems, documentState } from '../record-hub';
import { recordStatusPicture } from './record-status';

/** The English sentence for a state, read from the message catalogue by its key. */
const sentence = (label: string): string =>
  (appApplicantCatalog.en as Record<string, string>)[recordStatusPicture(label).sentenceKey] ?? '';

describe('the status picture of each Record state', () => {
  it('draws the Wallet picture that matches, by the state name the record says', () => {
    const kind = (label: string) => recordStatusPicture(label).kind;
    expect(kind('Current Version')).toBe('DOCUMENT_SUPPORTED');
    expect(kind('Needs Your Check')).toBe('EXTRACTED_PENDING');
    expect(kind('Still Being Checked')).toBe('DECLARED');
    expect(kind('Cannot Be Used')).toBe('CONFLICTED');
    expect(kind('Previous Version')).toBe('STALE');
  });

  it('has a plain sentence for every state the Record can say, and none for a made-up one', () => {
    const states = [
      { lifecycle: 'CURRENT', safetyStatus: 'CLEAN', processingStatus: 'AWAITING_REVIEW' },
      { lifecycle: 'EXPIRING', safetyStatus: 'CLEAN', processingStatus: 'AWAITING_REVIEW' },
      { lifecycle: 'EXPIRED', safetyStatus: 'CLEAN', processingStatus: 'AWAITING_REVIEW' },
      { lifecycle: 'SUPERSEDED', safetyStatus: 'CLEAN', processingStatus: 'AWAITING_REVIEW' },
      { lifecycle: 'CURRENT', safetyStatus: 'QUARANTINED', processingStatus: null },
    ] as const;
    const review = { expiryMissing: false, kindNeedsCheck: false, namePending: false };
    for (const state of states) {
      const label = documentState({ ...state, checked: true, review }).status.label;
      expect(sentence(label).length, label).toBeGreaterThan(20);
      expect(sentence(label), label).not.toBe('Saved in this record.');
    }
    // The profile section states too, as the Record builds them.
    const sections = buildRecordItems({
      applicantId: 'person',
      details: [
        { key: 'a', label: 'A', groupLabel: 'G', answered: 0, total: 3 },
        { key: 'b', label: 'B', groupLabel: 'G', answered: 1, total: 3 },
        { key: 'c', label: 'C', groupLabel: 'G', answered: 3, total: 3 },
      ],
      documents: [],
    });
    for (const item of sections) {
      expect(sentence(item.status.label), item.status.label).not.toBe('Saved in this record.');
    }
    expect(sentence('Made Up')).toBe('Saved in this record.');
  });
});
