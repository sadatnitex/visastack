import {
  DEFAULT_DOCUMENT_PROTECTION,
  type DocumentProtectionSettings,
  applyDocumentProtectionOverrides,
} from '@visastack/services';
import { describe, expect, it } from 'vitest';
import { type DocumentSuggestionInput, documentSuggestionView } from './document-suggestion';

const suggestionOf = (
  d: DocumentSuggestionInput,
  k: Parameters<typeof documentSuggestionView>[1],
  n: string,
  protection: DocumentProtectionSettings = DEFAULT_DOCUMENT_PROTECTION,
) => documentSuggestionView(d, k, n, protection);

const doc = (overrides: Partial<DocumentSuggestionInput> = {}): DocumentSuggestionInput => ({
  id: 'd1',
  originalName: 'scan.pdf',
  docType: null,
  safetyStatus: 'CLEAN',
  processingStatus: 'AWAITING_REVIEW',
  classification: { classifiedType: 'BANK_STATEMENT', confidence: 67, reviewRequired: false },
  pendingNameVersion: { id: 'n1', proposedName: 'Bank Statement - Anna Eriksson.pdf' },
  ...overrides,
});
const aiKind = { id: 'k1', suggestedType: 'PASSPORT', confidence: 99 };

describe('the suggestion a document is waiting on', () => {
  it('shows the rules kind, the waiting name and where the Record lists it', () => {
    expect(suggestionOf(doc(), undefined, 'Anna Eriksson')).toEqual({
      documentId: 'd1',
      nameVersionId: 'n1',
      typeProposalId: null,
      kind: 'BANK_STATEMENT',
      kindLabel: 'Bank Statement',
      recordGroup: 'Money',
      source: 'rules',
      clear: false,
      proposedName: 'Bank Statement - Anna Eriksson.pdf',
      nameAfterKind: ' - Anna Eriksson.pdf',
      protectedNow: true,
      removesFreshSignIn: false,
    });
    const sure = doc({
      classification: { classifiedType: 'PASSPORT', confidence: 100, reviewRequired: false },
    });
    expect(suggestionOf(sure, undefined, 'Anna')?.clear).toBe(true);
  });

  it('puts a waiting AI kind first, and an AI kind always reads Please Check', () => {
    const view = suggestionOf(doc(), aiKind, 'Anna Eriksson');
    expect(view).toMatchObject({
      kind: 'PASSPORT',
      recordGroup: 'Travel Documents',
      source: 'ai',
      clear: false,
      typeProposalId: 'k1',
    });
  });

  it('never offers to undo a kind the person set', () => {
    const view = suggestionOf(doc({ docType: 'SALARY_SLIP' }), aiKind, 'Anna');
    expect(view).toMatchObject({ kind: 'SALARY_SLIP', source: 'rules', typeProposalId: null });
    expect(
      suggestionOf(doc({ docType: 'SALARY_SLIP', pendingNameVersion: null }), aiKind, 'A'),
    ).toBeNull();
  });

  it("never pairs the person's own kind with a name made for another kind", () => {
    const remade = suggestionOf(doc({ docType: 'SALARY_SLIP' }), undefined, 'Anna Eriksson');
    expect(remade).toMatchObject({
      kind: 'SALARY_SLIP',
      nameVersionId: 'n1',
      proposedName: 'Salary Slip - Anna Eriksson.pdf',
    });
    const fits = suggestionOf(doc({ docType: 'BANK_STATEMENT' }), undefined, 'Anna Eriksson');
    expect(fits?.proposedName).toBe('Bank Statement - Anna Eriksson.pdf');
  });

  it('warns when accepting would drop the fresh sign-in check, following the live switches', () => {
    const booking = { id: 'k2', suggestedType: 'HOTEL_BOOKING', confidence: 90 };
    const unknown = doc({ pendingNameVersion: null, classification: null });
    expect(suggestionOf(unknown, booking, 'Anna')).toMatchObject({
      protectedNow: true,
      removesFreshSignIn: true,
    });
    expect(suggestionOf(unknown, aiKind, 'Anna')?.removesFreshSignIn).toBe(false);
    const unknownOpen = applyDocumentProtectionOverrides(DEFAULT_DOCUMENT_PROTECTION, [
      { scope: 'UNKNOWN_TYPE', key: 'unknown', restricted: false },
    ]);
    expect(suggestionOf(unknown, booking, 'Anna', unknownOpen)).toMatchObject({
      protectedNow: false,
      removesFreshSignIn: false,
    });
  });

  it('builds a name from the kind when only a kind is waiting', () => {
    const view = suggestionOf(
      doc({ pendingNameVersion: null, classification: null }),
      { id: 'k1', suggestedType: 'BIRTH_CERTIFICATE', confidence: 70 },
      'Anna Eriksson',
    );
    expect(view?.nameVersionId).toBeNull();
    expect(view?.proposedName).toBe('Birth Certificate - Anna Eriksson.pdf');
  });

  it('is nothing when nothing is waiting, or the file is not past its safety checks', () => {
    expect(suggestionOf(doc({ pendingNameVersion: null }), undefined, 'Anna')).toBeNull();
    for (const unsafe of [
      { safetyStatus: 'QUARANTINED', processingStatus: 'NEEDS_ATTENTION' },
      { safetyStatus: 'CLEAN', processingStatus: 'EXTRACTING' },
    ]) {
      expect(suggestionOf(doc(unsafe), aiKind, 'Anna')).toBeNull();
    }
  });
});
