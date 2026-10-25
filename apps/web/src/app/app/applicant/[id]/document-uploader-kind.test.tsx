// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./actions', () => ({ uploadDocumentAction: vi.fn() }));

const { DocumentUploader } = await import('./document-uploader');

const groups = [
  {
    key: 'identity',
    label: 'Identity',
    choices: [
      { key: 'PASSPORT', label: 'Passport' },
      { key: 'OTHER', label: 'Other Document' },
    ],
  },
];

async function mount(props: Partial<Parameters<typeof DocumentUploader>[0]> = {}) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<DocumentUploader applicantId="a-1" {...props} />);
  });
  return host;
}

describe('choosing the kind of document on the upload form', () => {
  it('starts on a kind chosen from a profile section, and says when the original is usually needed', async () => {
    const host = await mount({
      kindGroups: groups,
      initialKind: 'PASSPORT',
      originalKinds: ['PASSPORT'],
    });
    const select = host.querySelector('select[name="docType"]') as HTMLSelectElement;
    expect(select.value).toBe('PASSPORT');
    expect(host.querySelector('[data-testid="original-needed-note"]')?.textContent).toContain(
      'handed in as the original',
    );
    const other = await mount({ kindGroups: groups, originalKinds: ['PASSPORT'] });
    expect(other.querySelector('[data-testid="original-needed-note"]')).toBeNull();
  });

  it('offers the kinds, optional, with "Not sure yet" first and a note on why to choose', async () => {
    const host = await mount({ kindGroups: groups });
    const select = host.querySelector('select[name="docType"]') as HTMLSelectElement;
    expect(select.required).toBe(false);
    expect([...select.options].map((o) => o.textContent)).toEqual([
      'Not sure yet',
      'Passport',
      'Other Document',
    ]);
    expect(host.querySelector(`label[for="${select.id}"]`)?.textContent).toContain(
      'Kind of Document',
    );
    expect(host.textContent).toContain('right sharing category');
  });

  it('asks what an Other kind is only when Other is chosen', async () => {
    const host = await mount({ kindGroups: groups });
    const select = host.querySelector('select[name="docType"]') as HTMLSelectElement;
    expect(host.querySelector('input[name="subject"]')).toBeNull();
    await act(async () => {
      select.value = 'OTHER';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(host.querySelector('input[name="subject"]')).not.toBeNull();
    await act(async () => {
      select.value = 'PASSPORT';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(host.querySelector('input[name="subject"]')).toBeNull();
  });

  it('shows no kind field when it has no kinds to offer, so the form works as before', async () => {
    const host = await mount();
    expect(host.querySelector('select[name="docType"]')).toBeNull();
    expect(host.querySelector('input[type="file"]')).not.toBeNull();
  });
});
