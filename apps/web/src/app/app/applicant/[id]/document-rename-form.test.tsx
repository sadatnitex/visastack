// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const renameDocumentAction = vi.hoisted(() => vi.fn());
vi.mock('./actions', () => ({ renameDocumentAction }));

const { DocumentRenameForm } = await import('./document-rename-form');

let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = '';
  renameDocumentAction.mockReset();
});

async function mount(name: string) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(<DocumentRenameForm applicantId="a-1" documentId="d-1" name={name} />);
  });
  const input = host.querySelector('input[name="name"]') as HTMLInputElement;
  const form = host.querySelector('form') as HTMLFormElement;
  return { host, input, form };
}

/** Type into the box the way a person does, so React sees the change. */
function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('renaming a document', () => {
  it('keeps what the person typed when the name is refused, and says why', async () => {
    renameDocumentAction.mockResolvedValue({
      ok: false,
      message: 'Enter a name for this document.',
      field: 'name',
    });
    const { host, input, form } = await mount('Passport, Nazmus');
    await act(async () => type(input, 'My Passport Scan'));
    await act(async () => form.requestSubmit());

    expect(renameDocumentAction).toHaveBeenCalledTimes(1);
    const sent = renameDocumentAction.mock.calls[0]?.[1] as FormData;
    expect(sent.get('name')).toBe('My Passport Scan');
    expect(input.value).toBe('My Passport Scan');
    expect(host.textContent).toContain('Enter a name for this document.');
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('shows the new name when the listed name changes', async () => {
    const { input } = await mount('Document, Nazmus, 27 Oct 2026');
    expect(input.value).toBe('Document, Nazmus, 27 Oct 2026');
    await act(async () => {
      root?.render(
        <DocumentRenameForm applicantId="a-1" documentId="d-1" name="Passport, Nazmus" />,
      );
    });
    const current = document.querySelector('input[name="name"]') as HTMLInputElement;
    expect(current.value).toBe('Passport, Nazmus');
  });

  it('keeps the confirmation and the focus after a save, and shows the saved name', async () => {
    renameDocumentAction.mockResolvedValue({
      ok: true,
      message: 'Name saved. It shows everywhere this document is listed.',
    });
    const { host, input, form } = await mount('Passport, Nazmus');
    input.focus();
    await act(async () => type(input, '  My   Passport  '));
    await act(async () => form.requestSubmit());
    expect(host.textContent).toContain('Name saved.');

    // The page refreshes with the name as the service saved it (cleaned).
    await act(async () => {
      root?.render(<DocumentRenameForm applicantId="a-1" documentId="d-1" name="My Passport" />);
    });
    const current = host.querySelector('input[name="name"]') as HTMLInputElement;
    // The same box, not a new form: the message and the focus are still there.
    expect(current).toBe(input);
    expect(current.value).toBe('My Passport');
    expect(host.textContent).toContain('Name saved.');
    expect(document.activeElement).toBe(current);
  });

  it('limits the name to the same length the service keeps', async () => {
    const { MAX_DOCUMENT_NAME_LENGTH } = await import('@visastack/core');
    const { input } = await mount('Passport, Nazmus');
    expect(input.maxLength).toBe(MAX_DOCUMENT_NAME_LENGTH);
  });
});
