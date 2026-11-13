// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../components/i18n-provider';
import { appApplicantCatalog } from '../../../../i18n/app-applicant';
import type { DocumentSuggestionView } from './document-suggestion';

/**
 * The kind and name card under Bengali (refill 7): choosing an "Other" kind asks What Is It? in
 * Bengali, while the first option of the English kind list and the Edit button stay English.
 */

vi.mock('./actions', () => ({ decideDocumentSuggestionAction: vi.fn() }));

const { DocumentSuggestionCard } = await import('./document-suggestion-card');

const bn = appApplicantCatalog.bn as Record<string, string>;
const K = 'appApplicant.appApplicantIdDocumentSuggestionCard.';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const suggestion: DocumentSuggestionView = {
  documentId: 'd1',
  nameVersionId: 'n1',
  typeProposalId: 'k1',
  kind: 'BANK_STATEMENT',
  kindLabel: 'Bank Statement',
  recordGroup: 'Money',
  source: 'ai',
  clear: false,
  proposedName: 'Bank Statement - Anna Eriksson.pdf',
  nameAfterKind: ' - Anna Eriksson.pdf',
  protectedNow: true,
  removesFreshSignIn: false,
};
const groups = [
  {
    key: 'money',
    label: 'Money',
    choices: [
      { key: 'BANK_STATEMENT', label: 'Bank Statement' },
      { key: 'OTHER_FINANCIAL_DOCUMENT', label: 'Other Financial Document' },
    ],
  },
];

function chooseOther(locale: 'en' | 'bn') {
  act(() =>
    root.render(
      <I18nProvider locale={locale} pageLang={locale}>
        <DocumentSuggestionCard
          applicantId="a1"
          suggestion={suggestion}
          groups={groups}
          protectedKinds={['BANK_STATEMENT', 'OTHER_FINANCIAL_DOCUMENT']}
        />
      </I18nProvider>,
    ),
  );
  const edit = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Edit');
  act(() => edit?.click());
  const select = host.querySelector<HTMLSelectElement>('select[name="docType"]');
  act(() => {
    if (!select) return;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(
      select,
      'OTHER_FINANCIAL_DOCUMENT',
    );
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  return select;
}

describe('the kind and name card under Bengali', () => {
  it('asks What Is It? in Bengali for an Other kind, and keeps the English kind list as it is', () => {
    const select = chooseOther('bn');
    const labels = [...host.querySelectorAll('label')].map((l) => l.textContent);
    expect(labels).toContain(bn[`${K}whatIsIt`]);
    expect(labels).not.toContain('What Is It?');
    // Held (refill 7): a Bengali first option would lead a list of English kinds.
    expect(bn[`${K}chooseAKind`]).toBeUndefined();
    expect(select?.options[0]?.textContent).toBe('Choose a Kind');
    expect(select?.options[1]?.textContent).toBe('Bank Statement');
  });

  it('is the same English as before under English', () => {
    chooseOther('en');
    const labels = [...host.querySelectorAll('label')].map((l) => l.textContent);
    expect(labels).toContain('What Is It?');
    expect(host.textContent).not.toMatch(/[ঀ-৿]/);
  });
});
