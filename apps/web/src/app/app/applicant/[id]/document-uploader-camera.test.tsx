// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./actions', () => ({ uploadDocumentAction: vi.fn() }));

const { DocumentUploader } = await import('./document-uploader');

describe('DocumentUploader camera button', () => {
  it('opens the camera only when asked, and the normal picker never does', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<DocumentUploader applicantId="a-1" />);
    });
    const input = host.querySelector('input[type="file"]') as HTMLInputElement;
    const camera = Array.from(host.querySelectorAll('button')).find(
      (button) => button.textContent === 'Take a Photo',
    ) as HTMLButtonElement;
    expect(input.hasAttribute('capture')).toBe(false);

    await act(async () => {
      camera.click();
    });
    expect(input.getAttribute('capture')).toBe('environment');

    await act(async () => {
      input.click();
    });
    expect(input.hasAttribute('capture')).toBe(false);
  });
});
