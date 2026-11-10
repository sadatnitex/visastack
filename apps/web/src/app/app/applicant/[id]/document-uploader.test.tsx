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

const copy = vi.hoisted(() => ({
  send: vi.fn(),
  report: vi.fn(),
  remove: vi.fn(),
  restore: vi.fn(),
}));
vi.mock('../../../../lib/document-upload-client', () => ({
  sendDocumentFile: copy.send,
  reportUploadProblem: copy.report,
}));
const shrinkCopy = vi.hoisted(() => ({ shrink: vi.fn() }));
vi.mock('../../../../lib/photo-shrink', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../lib/photo-shrink')>()),
  shrinkPhoto: shrinkCopy.shrink,
}));
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
  it('claims a virus scan only when one is switched on, and says plainly when it is not', () => {
    const off = textOf(renderToStaticMarkup(<DocumentUploader applicantId="a1" />));
    expect(off).not.toMatch(/scanned for viruses|are scanned|is scanned/);
    expect(off).toContain('type and structure are checked when it arrives');
    expect(off).toContain('This is not a virus scan.');
    const on = textOf(renderToStaticMarkup(<DocumentUploader applicantId="a1" virusScanning />));
    expect(on).toContain('scanned for viruses and cannot be opened until the scan finishes');
    expect(on).not.toContain('not a virus scan');
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

describe('a large photo is made smaller before it is sent (P2)', () => {
  const MB = 1024 * 1024;
  const ADDED = { kind: 'added', message: 'Photo added.', title: null };

  async function choose(file: File, props: { readonly pdfAccepted?: boolean } = {}) {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    copy.send.mockReset().mockResolvedValue(ADDED);
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <DocumentUploader applicantId="a1" limitBytes={4 * MB} limitLabel="4 MB" {...props} />,
      );
    });
    const picker = host.querySelector('input[aria-label="Document Files"]') as HTMLInputElement;
    Object.defineProperty(picker, 'files', { value: [file], configurable: true });
    await act(async () => {
      picker.dispatchEvent(new Event('change', { bubbles: true }));
    });
    for (let turn = 0; turn < 4; turn++) {
      await act(async () => {
        await Promise.resolve();
      });
    }
    return host;
  }
  const big = (name: string, type: string) =>
    new File([new Uint8Array(5 * MB)], name, { type, lastModified: 5 });
  const smaller = () => ({
    ok: true,
    file: new File([new Uint8Array(800_000)], 'IMG_7.jpg', { type: 'image/jpeg', lastModified: 5 }),
    fromBytes: 5 * MB,
    toBytes: 800_000,
  });

  it('shrinks a JPEG over the limit, sends the smaller copy through the same upload, and says so', async () => {
    shrinkCopy.shrink.mockReset().mockResolvedValue(smaller());
    const host = await choose(big('IMG_7.jpg', 'image/jpeg'));
    expect(shrinkCopy.shrink).toHaveBeenCalledTimes(1);
    expect(shrinkCopy.shrink.mock.calls[0]?.[1]).toBe(4 * MB);
    expect(copy.send).toHaveBeenCalledTimes(1);
    const sent = copy.send.mock.calls[0]?.[0] as {
      file: File;
      contentType: string;
      fileName: string;
    };
    expect(sent.file.size).toBe(800_000);
    expect(sent.contentType).toBe('image/jpeg');
    expect(sent.fileName).toBe('IMG_7.jpg');
    const note = host.querySelector('output.upload-item-status');
    expect(note?.textContent).toBe('Made smaller to fit: 5.2 MB to 800 KB');
    expect(host.textContent).toContain('Photo added.');
  });

  it('says it is making the photo smaller while it waits its turn', async () => {
    let finish: (value: unknown) => void = () => undefined;
    shrinkCopy.shrink.mockReset().mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const host = await choose(big('IMG_7.jpg', 'image/jpeg'));
    expect(host.textContent).toContain('Making this photo smaller to fit.');
    expect(host.querySelector('output.upload-summary')?.textContent).toBe(
      'Uploading 1 of 1: IMG_7.jpg.',
    );
    expect(copy.send).not.toHaveBeenCalled();
    await act(async () => {
      finish(smaller());
    });
    expect(copy.send).toHaveBeenCalledTimes(1);
  });

  it('does not shrink a PDF over the limit: it is refused as before and nothing is sent', async () => {
    shrinkCopy.shrink.mockReset();
    const host = await choose(big('visa.pdf', 'application/pdf'), { pdfAccepted: true });
    expect(shrinkCopy.shrink).not.toHaveBeenCalled();
    expect(copy.send).not.toHaveBeenCalled();
    expect(host.textContent).toContain('This file is larger than 4 MB.');
    expect(host.querySelector('output.upload-item-status')).toBeNull();
  });

  it('does not touch a photo under the limit', async () => {
    shrinkCopy.shrink.mockReset();
    const small = new File([new Uint8Array(2 * MB)], 'IMG_8.jpg', { type: 'image/jpeg' });
    const host = await choose(small);
    expect(shrinkCopy.shrink).not.toHaveBeenCalled();
    expect((copy.send.mock.calls[0]?.[0] as { file: File }).file).toBe(small);
    expect(host.querySelector('output.upload-item-status')).toBeNull();
  });

  it('says the browser could not work on the photo, and leaves a trace of it, when it cannot be read', async () => {
    shrinkCopy.shrink.mockReset().mockResolvedValue({ ok: false, reason: 'unreadable' });
    copy.report.mockReset();
    const host = await choose(big('IMG_7.jpg', 'image/jpeg'));
    expect(copy.send).not.toHaveBeenCalled();
    expect(host.textContent).toContain(
      'Not added. We could not make this photo smaller than 4 MB. Take the photo again.',
    );
    expect(copy.report).toHaveBeenCalledWith(
      expect.objectContaining({ route: 'upload', reason: 'unreadable', status: 0 }),
    );
  });

  it('says photos over the limit are made smaller, beside the limit', async () => {
    const html = textOf(
      renderToStaticMarkup(<DocumentUploader applicantId="a1" limitLabel="4 MB" />),
    );
    expect(html).toContain(
      'Up to 4 MB per file; JPG, PNG, HEIC, Word or text files. Larger photos are made smaller to fit.',
    );
  });

  it('stops and says what to do when the photo cannot be made small enough', async () => {
    shrinkCopy.shrink.mockReset().mockResolvedValue({ ok: false, reason: 'still_too_large' });
    const host = await choose(big('IMG_7.jpg', 'image/jpeg'), { pdfAccepted: true });
    expect(copy.send).not.toHaveBeenCalled();
    expect(host.textContent).toContain(
      'Not added. This photo is larger than 4 MB, and making it smaller would lose detail. Take the photo again, or send a PDF.',
    );
    expect(host.querySelector('output.upload-summary')?.textContent).toBe(
      '1 file not added; the list says why.',
    );
  });
});
