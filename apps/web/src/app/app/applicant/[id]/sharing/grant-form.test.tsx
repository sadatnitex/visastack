// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('./actions', () => ({
  createGrantAction: async () => ({ ok: true, message: 'Awaiting acceptance' }),
}));
const { GrantForm } = await import('./grant-form');
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root.render(
      <GrantForm
        applicantId="owned-person"
        documents={[
          { id: 'passport', displayName: 'Passport summary' },
          { id: 'statement', displayName: 'Redacted statement' },
        ]}
      />,
    ),
  );
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
function change(name: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(`input[name="${name}"]`);
  if (!input) throw new Error('Missing field');
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
function ready() {
  change('recipientEmail', 'synthetic@example.com');
  change('purpose', 'Visa review');
}
function chooseSome(group: 'profileScope' | 'documentScope') {
  const radios = container.querySelectorAll<HTMLInputElement>(`input[name="${group}"]`);
  act(() => radios[1]?.click());
}
function review() {
  const button = [...container.querySelectorAll('button')].find(
    (node) => node.textContent === 'Review and confirm',
  );
  if (!button) throw new Error('Missing review');
  act(() => button.click());
}
describe('categories that hold saved details', () => {
  it('lists the live parts plus any new category with a saved detail, and carries it in the form', () => {
    act(() =>
      root.render(
        <GrantForm
          applicantId="owned-person"
          documents={[{ id: 'passport', displayName: 'Passport summary' }]}
          extraCategories={[{ key: 'study', label: 'Study' }]}
        />,
      ),
    );
    chooseSome('profileScope');
    const study = container.querySelector<HTMLInputElement>(
      'input[name="category"][value="study"]',
    );
    expect(study).not.toBeNull();
    expect(container.querySelector('input[name="category"][value="universal"]')).not.toBeNull();
    act(() => study?.click());
    expect(container.textContent).toContain('Study');
  });

  it('warns that documents with no kind are left out when parts are chosen, and links to set them', () => {
    act(() =>
      root.render(
        <GrantForm
          applicantId="owned-person"
          documents={[{ id: 'passport', displayName: 'Passport summary' }]}
          unsortedDocuments={2}
        />,
      ),
    );
    expect(container.querySelector('[data-testid="unsorted-documents-note"]')).toBeNull();
    chooseSome('profileScope');
    const note = container.querySelector('[data-testid="unsorted-documents-note"]');
    expect(note?.textContent).toContain('2 of your documents have no kind set');
    expect(note?.querySelector('a')?.getAttribute('href')).toBe(
      '/app/applicant/owned-person/documents',
    );
  });

  it('shows no such note when every document has a kind', () => {
    chooseSome('profileScope');
    expect(container.querySelector('[data-testid="unsorted-documents-note"]')).toBeNull();
  });

  it('offers no extra categories unless some hold details', () => {
    chooseSome('profileScope');
    expect(container.querySelectorAll('input[name="category"]')).toHaveLength(5);
  });
});

describe('native scoped sharing confirmation', () => {
  it('requires a valid recipient and purpose before enabling explicit confirmation', () => {
    const submit = container.querySelector<HTMLButtonElement>('button[type="submit"]');
    expect(submit?.disabled).toBe(true);
    review();
    expect(submit?.disabled).toBe(true);
    ready();
    review();
    expect(submit?.disabled).toBe(false);
    expect(container.textContent).toContain('They must accept');
    expect(container.textContent).toContain('your whole profile');
    expect(container.textContent).toContain('every document');
    expect(document.activeElement?.className).toBe('sharing-scope-review');
  });
  it('shows selected document names and exact download scope without changing native payloads', () => {
    ready();
    chooseSome('documentScope');
    act(() => container.querySelector<HTMLInputElement>('input[value="passport"]')?.click());
    act(() =>
      container.querySelector<HTMLInputElement>('input[value="DOWNLOAD_REDACTED"]')?.click(),
    );
    change('expiryDays', '7');
    review();
    const summary = container.querySelector('.sharing-scope-review')?.textContent ?? '';
    expect(summary).toContain('Passport summary');
    expect(summary).not.toContain('Redacted statement');
    expect(summary).toContain('original downloads are not included');
    expect(summary).toContain('7 days');
    const form = container.querySelector('form');
    if (!form) throw new Error('Form');
    const data = new FormData(form);
    expect(data.getAll('documentId')).toEqual(['passport']);
    expect(data.getAll('action')).toEqual(['VIEW_METADATA', 'PREVIEW', 'DOWNLOAD_REDACTED']);
    expect(data.get('applicantId')).toBe('owned-person');
    expect(container.querySelector('input[value="DOWNLOAD_ORIGINAL"]')).toBeNull();
  });
  it('shares everything only as a visible choice and sends no scope fields for it', () => {
    ready();
    const form = container.querySelector('form');
    if (!form) throw new Error('Form');
    expect(container.textContent).toContain('Everything in my profile');
    expect(container.textContent).not.toContain('Leave all unchecked');
    const data = new FormData(form);
    expect(data.getAll('category')).toEqual([]);
    expect(data.getAll('documentId')).toEqual([]);
    expect(data.has('profileScope')).toBe(false);
    expect(data.has('documentScope')).toBe(false);
  });
  it('does not let a partial choice with nothing chosen quietly share everything', () => {
    ready();
    chooseSome('profileScope');
    review();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Choose at least one part of your profile',
    );
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(
      true,
    );
    act(() =>
      container
        .querySelector<HTMLInputElement>('input[name="category"][value="universal"]')
        ?.click(),
    );
    review();
    expect(container.querySelector('[role="alert"]')?.textContent ?? '').not.toContain(
      'Choose at least one',
    );
    const data = new FormData(container.querySelector('form') as HTMLFormElement);
    expect(data.getAll('category')).toEqual(['universal']);
  });
  it('invalidates confirmation after edits and refuses a permission-free request', () => {
    ready();
    review();
    change('purpose', 'Changed purpose');
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(
      true,
    );
    act(() => container.querySelector<HTMLInputElement>('input[value="VIEW_METADATA"]')?.click());
    act(() => container.querySelector<HTMLInputElement>('input[value="PREVIEW"]')?.click());
    review();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Select at least one permission',
    );
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(
      true,
    );
  });
  it('blocks implicit submission until the current scope has been reviewed', () => {
    ready();
    const form = container.querySelector('form');
    if (!form) throw new Error('Form');
    const event = new Event('submit', { bubbles: true, cancelable: true });
    act(() => form.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(container.textContent).toContain('Confirm this access');
  });
});
