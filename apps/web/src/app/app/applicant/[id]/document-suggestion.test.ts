import { describe, expect, it } from 'vitest';
import { type DocumentSuggestionInput, documentSuggestionView } from './document-suggestion';

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
    expect(documentSuggestionView(doc(), undefined, 'Anna Eriksson')).toEqual({
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
    });
    const sure = doc({
      classification: { classifiedType: 'PASSPORT', confidence: 100, reviewRequired: false },
    });
    expect(documentSuggestionView(sure, undefined, 'Anna')?.clear).toBe(true);
  });

  it('puts a waiting AI kind first, and an AI kind always reads Please Check', () => {
    const view = documentSuggestionView(doc(), aiKind, 'Anna Eriksson');
    expect(view).toMatchObject({
      kind: 'PASSPORT',
      recordGroup: 'Travel Documents',
      source: 'ai',
      clear: false,
      typeProposalId: 'k1',
    });
  });

  it('never offers to undo a kind the person set', () => {
    const view = documentSuggestionView(doc({ docType: 'SALARY_SLIP' }), aiKind, 'Anna');
    expect(view).toMatchObject({ kind: 'SALARY_SLIP', source: 'rules', typeProposalId: null });
    expect(
      documentSuggestionView(
        doc({ docType: 'SALARY_SLIP', pendingNameVersion: null }),
        aiKind,
        'A',
      ),
    ).toBeNull();
  });

  it('builds a name from the kind when only a kind is waiting', () => {
    const view = documentSuggestionView(
      doc({ pendingNameVersion: null, classification: null }),
      { id: 'k1', suggestedType: 'BIRTH_CERTIFICATE', confidence: 70 },
      'Anna Eriksson',
    );
    expect(view?.nameVersionId).toBeNull();
    expect(view?.proposedName).toBe('Birth Certificate - Anna Eriksson.pdf');
  });

  it('is nothing when nothing is waiting, or the file is not past its safety checks', () => {
    expect(documentSuggestionView(doc({ pendingNameVersion: null }), undefined, 'Anna')).toBeNull();
    for (const unsafe of [
      { safetyStatus: 'QUARANTINED', processingStatus: 'NEEDS_ATTENTION' },
      { safetyStatus: 'CLEAN', processingStatus: 'EXTRACTING' },
    ]) {
      expect(documentSuggestionView(doc(unsafe), aiKind, 'Anna')).toBeNull();
    }
  });
});
