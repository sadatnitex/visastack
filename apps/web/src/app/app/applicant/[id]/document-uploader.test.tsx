import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { formatFileSize } from '../../../../lib/format-size';
import { textOf } from '../../../../lib/next-mocks.test-support';

vi.mock('./actions', () => ({
  uploadDocumentAction: async () => ({ ok: true, message: '' }),
}));

const { DocumentUploader, UPLOADING_SLOW_TEXT, UPLOADING_TEXT, UPLOAD_UNKNOWN_OUTCOME } =
  await import('./document-uploader');

describe('the upload form', () => {
  const html = renderToStaticMarkup(<DocumentUploader applicantId="a1" limitLabel="5 MB" />);

  it('names the file field and accepts the formats the pipeline handles, PDF included', () => {
    expect(html).toContain('aria-label="Document file"');
    expect(html).toContain('application/pdf');
    expect(textOf(html)).toContain('PDF, PNG, JPEG, DOCX, TXT or MD');
  });

  it('states the limit it was given, not a number written into the form', () => {
    expect(textOf(html)).toContain('up to 5 MB');
    expect(textOf(renderToStaticMarkup(<DocumentUploader applicantId="a1" />))).toContain(
      'up to 20 MB',
    );
  });

  it('has its result regions in the page before anything happens, so the result is announced', () => {
    expect(html).toContain('<output class="field-msg field-msg-ok"></output>');
    expect(html).toContain('role="alert"');
  });

  it('is a normal submit button that does not become disabled while an upload runs', () => {
    expect(html).toContain('type="submit"');
    expect(html).toContain('>Upload document</button>');
    expect(html).not.toContain('disabled');
  });

  it('is a real form that posts the applicant and the file', () => {
    expect(html).toContain('<form');
    expect(html).toContain('name="applicantId" value="a1"');
    expect(html).toContain('name="file"');
  });
});

describe('what the form says when an upload goes quiet', () => {
  it('says it is not known whether the file arrived, and where to look first', () => {
    expect(UPLOAD_UNKNOWN_OUTCOME).toContain('could not confirm whether your upload finished');
    expect(UPLOAD_UNKNOWN_OUTCOME).toContain(
      'Check the list of documents below before uploading again',
    );
    // It must never claim the upload failed: it may well have worked.
    expect(UPLOAD_UNKNOWN_OUTCOME.toLowerCase()).not.toContain('failed');
  });

  it('tells a person to keep the page open while it uploads, and says when it is taking long', () => {
    expect(UPLOADING_TEXT).toContain('keep this page open');
    expect(UPLOADING_SLOW_TEXT).toContain('taking longer than usual');
    expect(UPLOADING_SLOW_TEXT).toContain('check the list of documents below before trying again');
  });
});

describe('what the upload form claims about checking', () => {
  it('claims a virus scan only when one is switched on', () => {
    const off = textOf(renderToStaticMarkup(<DocumentUploader applicantId="a1" />));
    expect(off).not.toContain('viruses');
    expect(off).toContain('file type and structure are checked on upload');
    const on = textOf(renderToStaticMarkup(<DocumentUploader applicantId="a1" virusScanning />));
    expect(on).toContain('scanned for viruses on upload');
  });

  it('says where the file is kept and who can open it', () => {
    expect(textOf(renderToStaticMarkup(<DocumentUploader applicantId="a1" />))).toContain(
      'Stored privately. Only you and the people you choose to share with can open it.',
    );
  });

  it('writes a chosen file size in words a person can read', () => {
    expect(formatFileSize(310_000)).toBe('310 KB');
    expect(formatFileSize(2_400_000)).toBe('2.4 MB');
    expect(formatFileSize(512)).toBe('512 bytes');
  });
});
