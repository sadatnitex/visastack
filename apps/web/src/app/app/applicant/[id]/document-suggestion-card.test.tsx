// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentSuggestionView } from './document-suggestion';

vi.mock('./actions', () => ({ decideDocumentSuggestionAction: vi.fn() }));

const { DocumentSuggestionCard } = await import('./document-suggestion-card');

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
  kind: 'EMPLOYMENT_CERTIFICATE',
  kindLabel: 'Employment Certificate',
  recordGroup: 'Employment and Business',
  source: 'ai',
  clear: false,
  proposedName: 'Employment Certificate - Anna Eriksson.pdf',
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

function render(view: DocumentSuggestionView = suggestion) {
  act(() =>
    root.render(
      <DocumentSuggestionCard
        applicantId="a1"
        suggestion={view}
        groups={groups}
        protectedKinds={['BANK_STATEMENT', 'OTHER_FINANCIAL_DOCUMENT']}
      />,
    ),
  );
}

const buttons = () => [...host.querySelectorAll('button')].map((b) => b.textContent);
const field = (name: string) =>
  host.querySelector<HTMLInputElement>(`form.finding-form [name="${name}"]`)?.value;

describe('the kind and name card', () => {
  it('says what we think it is, the name, and where the Record lists it, and saves nothing yet', () => {
    render();
    expect(host.querySelector('h3')?.textContent).toBe('Check the Kind and Name');
    expect(host.querySelector('h4')?.textContent).toBe(
      'We think this is an Employment Certificate',
    );
    expect(host.textContent).toContain('Employment Certificate - Anna Eriksson.pdf');
    expect(host.textContent).toContain('Employment and Business on your Record');
    expect(host.textContent).toContain('Read by AI');
    expect(host.textContent).toContain('Please Check');
    expect(host.textContent).toContain('Nothing is saved until you accept.');
    expect(buttons()).toEqual(['Accept', 'Edit', 'Skip']);
    // Accept sends the suggested kind and name, together with both suggestions it answers.
    expect(field('docType')).toBe('EMPLOYMENT_CERTIFICATE');
    expect(field('name')).toBe('Employment Certificate - Anna Eriksson.pdf');
    expect(field('nameVersionId')).toBe('n1');
    expect(field('typeProposalId')).toBe('k1');
  });

  it('lets the person choose another kind from the catalogue and change the name', () => {
    render({ ...suggestion, kind: 'BANK_STATEMENT', kindLabel: 'Bank Statement' });
    const edit = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Edit');
    act(() => edit?.click());
    const select = host.querySelector<HTMLSelectElement>('select[name="docType"]');
    expect(select?.value).toBe('BANK_STATEMENT');
    expect([...(select?.options ?? [])].map((o) => o.textContent)).toEqual([
      'Choose a Kind',
      'Bank Statement',
      'Other Financial Document',
    ]);
    expect(host.querySelector<HTMLInputElement>('input[name="name"]')?.value).toBe(
      'Employment Certificate - Anna Eriksson.pdf',
    );
    expect(buttons()).toEqual(['Save', 'Cancel', 'Skip']);
    for (const label of host.querySelectorAll('label')) {
      expect(label.getAttribute('for')).toBeTruthy();
    }
  });

  it('renames for the chosen kind until the person types their own name', () => {
    render({ ...suggestion, kind: 'BANK_STATEMENT', kindLabel: 'Bank Statement' });
    const edit = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Edit');
    act(() => edit?.click());
    const select = host.querySelector<HTMLSelectElement>('select[name="docType"]');
    const input = () => host.querySelector<HTMLInputElement>('input[name="name"]');
    const choose = (value: string) =>
      act(() => {
        if (!select) return;
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
        setter?.call(select, value);
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
    choose('OTHER_FINANCIAL_DOCUMENT');
    expect(input()?.value).toBe('Other Financial Document - Anna Eriksson.pdf');
    act(() => {
      const field = input();
      if (!field) return;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
        field,
        'Mine',
      );
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    choose('BANK_STATEMENT');
    expect(input()?.value).toBe('Mine');
  });

  it('says plainly before Accept when accepting drops the fresh sign-in check', () => {
    const warning =
      'Accepting means this file no longer needs a fresh sign-in check before it opens.';
    render();
    expect(host.textContent).not.toContain(warning);
    render({ ...suggestion, removesFreshSignIn: true });
    expect(host.textContent).toContain(warning);
    const edit = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Edit');
    act(() => edit?.click());
    const select = host.querySelector<HTMLSelectElement>('select[name="docType"]');
    act(() => {
      if (!select) return;
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(
        select,
        'BANK_STATEMENT',
      );
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    // A protected kind keeps the check: no warning.
    expect(host.textContent).not.toContain(warning);
  });

  it('reads a confident rules kind as Clear without the AI badge', () => {
    render({ ...suggestion, source: 'rules', clear: true });
    expect(host.textContent).not.toContain('Read by AI');
    expect(host.textContent).toContain('Clear');
  });

  it('opens straight into choosing when nothing could tell the kind', () => {
    render({ ...suggestion, kind: null, kindLabel: null, recordGroup: null });
    expect(host.querySelector('h4')?.textContent).toBe(
      'We could not tell what kind of document this is',
    );
    expect(buttons()).toEqual(['Save', 'Skip']);
  });
});
