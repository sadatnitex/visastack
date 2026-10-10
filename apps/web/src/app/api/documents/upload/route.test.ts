import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';
const { session, applicant, upload } = vi.hoisted(() => ({
  session: vi.fn(),
  applicant: vi.fn(),
  upload: vi.fn(),
}));
vi.mock('../../../../lib/session', () => ({ withSession: session }));
vi.mock('@visastack/services', () => ({ getApplicant: applicant }));
vi.mock('../../../app/applicant/[id]/actions', () => ({ uploadDocumentAction: upload }));
const id = '00000000-0000-4000-8000-000000000001';
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function request(origin = 'https://app.example', bytes = png, type = 'image/png') {
  return new Request(`https://app.example/api/documents/upload?applicantId=${id}`, {
    method: 'POST',
    body: bytes,
    headers: { origin, 'content-type': type, 'content-length': String(bytes.length) },
  });
}
beforeEach(() => {
  session.mockReset();
  applicant.mockReset();
  upload.mockReset();
  session.mockImplementation((fn) => fn({ db: {}, accountId: 'owner' }));
  applicant.mockResolvedValue({ ownerAccountId: 'owner' });
  upload.mockResolvedValue({ ok: true, message: 'Uploaded.' });
});
afterEach(() => vi.unstubAllEnvs());
describe('authenticated raw document upload', () => {
  it('accepts PDF original bytes into the existing private intake action for the queued scanner', async () => {
    vi.stubEnv('MALWARE_SCANNER_PROVIDER', 'github_clamav');
    const bytes = Buffer.from('%PDF-1.7 synthetic fixture');
    expect((await POST(request('https://app.example', bytes, 'application/pdf'))).status).toBe(201);
    const file = upload.mock.calls[0]?.[1].get('file') as File;
    expect(Buffer.from(await file.arrayBuffer())).toEqual(bytes);
    expect(file.type).toBe('application/pdf');
  });
  it('rejects another origin and oversized requests before session work', async () => {
    expect((await POST(request('https://evil.example'))).status).toBe(403);
    const large = request();
    large.headers.set('content-length', String(4 * 1024 * 1024 + 1));
    expect((await POST(large)).status).toBe(413);
    expect(session).not.toHaveBeenCalled();
  });
  it('checks ownership before processing the body or invoking the upload action', async () => {
    applicant.mockResolvedValue({ ownerAccountId: 'other' });
    expect((await POST(request())).status).toBe(403);
    expect(upload).not.toHaveBeenCalled();
  });
  it('rejects executables and mismatched MIME before any storage action', async () => {
    expect((await POST(request('https://app.example', Buffer.from('MZexec')))).status).toBe(415);
    expect((await POST(request('https://app.example', png, 'image/jpeg'))).status).toBe(415);
    expect(upload).not.toHaveBeenCalled();
  });
  it('uses the existing quota and processing action with exact original bytes', async () => {
    expect((await POST(request())).status).toBe(201);
    const file = upload.mock.calls[0]?.[1].get('file') as File;
    expect(Buffer.from(await file.arrayBuffer())).toEqual(png);
    expect(file.type).toBe('image/png');
    expect(file.name).toBe('document');
  });
});
