// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { formatFileSize } from '../../../../lib/format-size';
import { textOf } from '../../../../lib/next-mocks.test-support';

const { DocumentUploader, UPLOAD_UNKNOWN_OUTCOME, uploadSummary } = await import(
  './document-uploader'
);

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => undefined }) }));

const copy = vi.hoisted(() => ({ send: vi.fn(), remove: vi.fn(), restore: vi.fn() }));
vi.mock('../../../../lib/document-upload-client', () => ({ sendDocumentFile: copy.send }));
vi.mock('./documents/manage/delete/actions', () => ({
  deleteDuplicateAction: copy.remove,
  restoreDeletedAction: copy.restore,
}));

describe('the upload form before anything is chosen', () => {
  const html = renderToStaticMarkup(
    <DocumentUploader applicantId="a1" limitBytes={4 * 1024 * 1024} limitLabel="4 MB" />,
  );

  it('says the limits in plain words before a file is chosen', () => {
    expect(textOf(html)).toContain('Up to 4 MB per file; JPG, PNG, HEIC, Word or text files.');
    const withPdf = textOf(
      renderToStaticMarkup(<DocumentUploader applicantId="a1" limitLabel="4 MB" pdfAccepted />),
    );
    expect(withPdf).toContain('Up to 4 MB per file; PDF, JPG, PNG, HEIC, Word or text files.');
  });

  it('takes several files at once through a picker that accepts iPhone photos', () => {
    expect(html).toContain('multiple=""');
    expect(html).toContain('aria-label="Document Files"');
    expect(html).toContain('image/heic');
    expect(html).toContain('.heic');
    // PDF is offered only when it can be admitted.
    expect(html).not.toContain('application/pdf');
    expect(renderToStaticMarkup(<DocumentUploader applicantId="a1" pdfAccepted />)).toContain(
      'application/pdf',
    );
  });

  it('has a labelled drop area whose buttons work by keyboard, and a separate camera control', () => {
    expect(html).toContain('<section class="upload-drop"');
    expect(textOf(html)).toContain('Drop Files Here');
    expect(html).toMatch(
      /<button type="button" class="btn btn-primary"[^>]*>Choose Files<\/button>/,
    );
    expect(html).toMatch(
      /<button type="button" class="btn btn-secondary"[^>]*>Take a Photo<\/button>/,
    );
    expect(html).toMatch(/<input[^>]*accept="image\/\*"[^>]*capture="environment"/);
    expect(html).not.toContain('disabled');
  });

  it('has its announcement region in the page before anything happens', () => {
    expect(html).toContain('<output class="upload-summary"></output>');
  });
});

describe('what the form says about each file and the whole list', () => {
  it('says it is not known whether a file arrived, and where to look first', () => {
    expect(UPLOAD_UNKNOWN_OUTCOME).toContain('could not confirm whether this upload finished');
    expect(UPLOAD_UNKNOWN_OUTCOME).toContain(
      'Check the list of documents below before uploading it again',
    );
    // It must never claim the upload failed: it may well have worked.
    expect(UPLOAD_UNKNOWN_OUTCOME.toLowerCase()).not.toContain('failed');
  });

  it('announces which file is going, then how the batch went', () => {
    expect(uploadSummary([])).toBe('');
    expect(
      uploadSummary([
        { status: 'added', name: 'a.jpg' },
        { status: 'sending', name: 'b.jpg' },
        { status: 'waiting', name: 'c.jpg' },
      ]),
    ).toBe('Uploading 2 of 3: b.jpg.');
    expect(uploadSummary([{ status: 'added', name: 'a.jpg' }])).toBe('1 file added.');
    expect(
      uploadSummary([
        { status: 'added', name: 'a.jpg' },
        { status: 'added', name: 'b.jpg' },
        { status: 'refused', name: 'c.jpg' },
      ]),
    ).toBe('2 files added. 1 file not added; the list says why.');
    expect(uploadSummary([{ status: 'not_sent', name: 'a.exe' }])).toBe(
      '1 file not added; the list says why.',
    );
  });
});

describe('what the upload form claims about checking', () => {
  it('claims a virus scan only when one is switched on', () => {
    const off = textOf(renderToStaticMarkup(<DocumentUploader applicantId="a1" />));
    expect(off).not.toContain('viruses');
    expect(off).toContain('type and structure are checked when it arrives');
    const on = textOf(renderToStaticMarkup(<DocumentUploader applicantId="a1" virusScanning />));
    expect(on).toContain('scanned for viruses when it arrives');
  });

  it('says where the file is kept, who can open it, and that iPhone photos become JPG copies', () => {
    const text = textOf(renderToStaticMarkup(<DocumentUploader applicantId="a1" />));
    expect(text).toContain(
      'Stored privately. Only you and the people you choose to share with can open it.',
    );
    expect(text).toContain('iPhone photos (HEIC) are saved as JPG copies');
  });

  it('writes a chosen file size in words a person can read', () => {
    expect(formatFileSize(310_000)).toBe('310 KB');
    expect(formatFileSize(2_400_000)).toBe('2.4 MB');
    expect(formatFileSize(512)).toBe('512 bytes');
  });
});

describe('Remove This New Copy after an upload (LC-C)', () => {
  const COPY = '11111111-1111-4111-8111-111111111111';

  async function uploadOne(outcome: Record<string, unknown>) {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    copy.send.mockResolvedValue(outcome);
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<DocumentUploader applicantId="a1" />);
    });
    const picker = host.querySelector('input[aria-label="Document Files"]') as HTMLInputElement;
    const file = new File(['x'], 'passport.jpg', { type: 'image/jpeg' });
    Object.defineProperty(picker, 'files', { value: [file], configurable: true });
    await act(async () => {
      picker.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => {
      await Promise.resolve();
    });
    return host;
  }
  const removeButton = (host: HTMLElement) =>
    [...host.querySelectorAll('button')].find((b) => b.textContent === 'Remove This New Copy');

  it('is not offered for an ordinary upload', async () => {
    const host = await uploadOne({ kind: 'added', message: 'Passport added.', title: null });
    expect(host.textContent).toContain('Passport added.');
    expect(removeButton(host)).toBeUndefined();
  });

  it('removes the new copy through Delete Duplicate, with Undo', async () => {
    copy.remove.mockReset().mockResolvedValue({ ok: true, days: 30 });
    copy.restore.mockReset().mockResolvedValue({ ok: true });
    const host = await uploadOne({
      kind: 'added',
      message: 'Passport added.',
      title: null,
      removableCopyId: COPY,
    });
    expect(host.textContent).toContain('You already keep an identical copy of this file.');
    await act(async () => {
      removeButton(host)?.click();
    });
    expect(copy.remove).toHaveBeenCalledWith('a1', COPY, true);
    expect(host.querySelector('output.lc-undo')?.textContent).toContain(
      'Moved to Recently Deleted. Removed in 30 Days.',
    );
    const undo = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Undo');
    await act(async () => {
      undo?.click();
    });
    expect(copy.restore).toHaveBeenCalledWith('a1', COPY, 'UNDO');
  });

  it('says why when the server refuses it', async () => {
    copy.remove
      .mockReset()
      .mockResolvedValue({ ok: false, message: 'This copy cannot be deleted right now.' });
    const host = await uploadOne({
      kind: 'added',
      message: 'Passport added.',
      title: null,
      removableCopyId: COPY,
    });
    await act(async () => {
      removeButton(host)?.click();
    });
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('cannot be deleted');
  });
});
