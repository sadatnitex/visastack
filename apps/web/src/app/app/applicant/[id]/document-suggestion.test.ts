import { describe, expect, it } from 'vitest';
import { type DocumentSuggestionInput, documentSuggestionView } from './document-suggestion';

const doc = (overrides: Partial<DocumentSuggestionInput> = {}): DocumentSuggestionInput => ({
  id: 'd1',
  originalName: 'scan.pdf',
  docType: null,
  classification: { classifiedType: 'BANK_STATEMENT', confidence: 67, reviewRequired: false },
  pendingNameVersion: { id: 'n1', proposedName: 'Bank Statement - Anna Eriksson.pdf' },
  ...overrides,
});

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
      currentKindLabel: null,
    });
  });

  it('puts a waiting AI kind first and reads a confident one as clear', () => {
    const view = documentSuggestionView(
      doc(),
      { id: 'k1', suggestedType: 'PASSPORT', confidence: 92 },
      'Anna Eriksson',
    );
    expect(view).toMatchObject({
      kind: 'PASSPORT',
      kindLabel: 'Passport',
      recordGroup: 'Travel Documents',
      source: 'ai',
      clear: true,
      typeProposalId: 'k1',
    });
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

  it('says so when the suggestion differs from the kind the person chose', () => {
    const view = documentSuggestionView(doc({ docType: 'SALARY_SLIP' }), undefined, 'Anna');
    expect(view?.currentKindLabel).toBe('Salary Slip');
  });

  it('is nothing when no name or kind is waiting', () => {
    expect(documentSuggestionView(doc({ pendingNameVersion: null }), undefined, 'Anna')).toBeNull();
  });
});
