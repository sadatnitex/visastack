// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { fixtureDocumentGroups, fixtureFieldGroups } from '../../../../lib/master-profile-fixture';

vi.mock('./actions', () => ({ requestEvidenceAction: vi.fn() }));

const { RequestEvidenceForm } = await import('./request-evidence-form');

const html = renderToStaticMarkup(
  <RequestEvidenceForm
    organizationId="org-1"
    fieldGroups={fixtureFieldGroups}
    documentGroups={fixtureDocumentGroups}
    applicants={[{ applicantId: 'a-1', displayName: 'Test Applicant' }]}
  />,
);
const visibleText = html.replace(/<[^>]*>/g, '|');

describe('RequestEvidenceForm wording', () => {
  it('shows plain words and no stored codes as visible text', () => {
    expect(visibleText).toContain('What do you need?');
    expect(visibleText).toContain('A Detail from the Profile');
    expect(visibleText).toContain('Passport Number');
    expect(visibleText).not.toMatch(/passport_number|bank_statement|Field key/);
  });

  it('still submits the stored code for the chosen detail', () => {
    expect(html).toContain('value="passport_number"');
    expect(html).toContain('name="key"');
  });

  it('offers a detail that only the catalogue added, under its own group', () => {
    expect(visibleText).toContain('Institution Name');
    expect(html).toContain('value="study_institution_name"');
    expect(html).toMatch(/<optgroup label="Study">/);
  });
});

describe('RequestEvidenceForm document choice', () => {
  const mount = async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <RequestEvidenceForm
          organizationId="org-1"
          fieldGroups={fixtureFieldGroups}
          documentGroups={fixtureDocumentGroups}
          applicants={[{ applicantId: 'a-1', displayName: 'Test Applicant' }]}
        />,
      );
    });
    return host;
  };
  const change = async (element: HTMLSelectElement, value: string) => {
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
      setter?.call(element, value);
      element.dispatchEvent(new Event('change', { bubbles: true }));
    });
  };

  it('sends the stored code for a named document and the typed name for another one', async () => {
    const host = await mount();
    await change(host.querySelector('#kind') as HTMLSelectElement, 'DOCUMENT');
    const choice = host.querySelector('#key') as HTMLSelectElement;
    expect(choice.textContent).toContain('Passport');
    expect(choice.textContent).toContain('Other Document');
    expect(choice.textContent).toContain('Something Else');
    await change(choice, 'BANK_STATEMENT');
    expect((host.querySelector('input[name="key"]') as HTMLInputElement).value).toBe(
      'BANK_STATEMENT',
    );
    await change(choice, '__other__');
    const typed = host.querySelector('input[name="key"]') as HTMLInputElement;
    expect(typed.type).toBe('text');
    expect(typed.required).toBe(true);
  });

  it('goes back to asking for a detail when the form is reset after sending', async () => {
    const host = await mount();
    await change(host.querySelector('#kind') as HTMLSelectElement, 'DOCUMENT');
    await change(host.querySelector('#key') as HTMLSelectElement, '__other__');
    // React resets a form once its action has run; the lists must follow the reset.
    await act(async () => {
      (host.querySelector('form') as HTMLFormElement).reset();
    });
    expect((host.querySelector('#kind') as HTMLSelectElement).value).toBe('FIELD');
    expect(host.querySelector('label[for="key"]')?.textContent).toBe('Which detail?');
    expect(host.querySelector('#key')?.getAttribute('name')).toBe('key');
    expect(host.querySelector('#otherDocument')).toBeNull();
  });
});
