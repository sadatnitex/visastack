import { MADE_UP_HEIC_SMALL } from '@visastack/adapters/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST, uploadRetryAfterSeconds } from './route';
const { session, applicant, upload } = vi.hoisted(() => ({
  session: vi.fn(),
  applicant: vi.fn(),
  upload: vi.fn(),
}));
vi.mock('../../../../lib/session', () => ({ withSession: session }));
vi.mock('@visastack/services', () => ({
  getApplicant: applicant,
  RATE_LIMITS: { UPLOAD_RESERVE: { limit: 200, windowMs: 60 * 60 * 1000 } },
}));
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
  it('passes the upgrade line on with a refusal only (ADR 0025)', async () => {
    upload.mockResolvedValueOnce({ ok: false, message: 'Full.', upgrade: 'storage' });
    const refused = await POST(request());
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ message: 'Full.', upgrade: 'storage' });
    upload.mockResolvedValueOnce({ ok: false, message: 'Full.' });
    expect(await (await POST(request())).json()).toEqual({ message: 'Full.' });
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

  it('passes the chosen kind and an Other name on to the action, decoded', async () => {
    const withKind = request();
    withKind.headers.set('x-document-kind', 'OTHER');
    withKind.headers.set('x-document-name', encodeURIComponent('Acte de Mariage, Am\u00E9lie'));
    expect((await POST(withKind)).status).toBe(201);
    const form = upload.mock.calls[0]?.[1] as FormData;
    expect(form.get('docType')).toBe('OTHER');
    expect(form.get('subject')).toBe('Acte de Mariage, Am\u00E9lie');

    // Broken encoding is dropped, not passed on as it came.
    upload.mockClear();
    const broken = request();
    broken.headers.set('x-document-name', '%E0%A4%A');
    expect((await POST(broken)).status).toBe(201);
    expect((upload.mock.calls[0]?.[1] as FormData).get('subject')).toBe('');
  });

  it('answers with the title the document is listed under', async () => {
    upload.mockResolvedValue({ ok: true, message: 'Passport added.', title: 'Passport, Nazmus' });
    const response = await POST(request());
    expect(await response.json()).toEqual({
      message: 'Passport added.',
      title: 'Passport, Nazmus',
    });
  });

  it('passes on an exact copy to remove only when the upload says so (LC-C)', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    upload.mockResolvedValue({ ok: true, message: 'Passport added.', removableCopyId: id });
    expect(await (await POST(request())).json()).toEqual({
      message: 'Passport added.',
      removableCopyId: id,
    });
    // An ordinary upload answers exactly as before.
    upload.mockResolvedValue({ ok: true, message: 'Passport added.' });
    expect(await (await POST(request())).json()).toEqual({ message: 'Passport added.' });
    // A refusal never carries it.
    upload.mockResolvedValue({ ok: false, message: 'No.', removableCopyId: id });
    expect(await (await POST(request())).json()).toEqual({ message: 'No.' });
  });

  it('admits an iPhone photo for conversion, but not anything merely called one', async () => {
    const heic = Buffer.from(MADE_UP_HEIC_SMALL);
    expect((await POST(request('https://app.example', heic, 'image/heic'))).status).toBe(201);
    const file = upload.mock.calls[0]?.[1].get('file') as File;
    expect(file.type).toBe('image/heic');
    upload.mockClear();
    expect((await POST(request('https://app.example', png, 'image/heic'))).status).toBe(415);
    expect((await POST(request('https://app.example', heic, 'image/png'))).status).toBe(415);
    expect(upload).not.toHaveBeenCalled();
  });

  it('answers the hourly upload limit with 429, its own line and how long until it frees', async () => {
    const line = 'too many upload requests in a short time - please try again later';
    upload.mockResolvedValueOnce({ ok: false, message: line, refusal: 'rate_limited' });
    const limited = await POST(request());
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ message: line });
    const wait = Number(limited.headers.get('retry-after'));
    expect(Number.isInteger(wait)).toBe(true);
    expect(wait).toBeGreaterThanOrEqual(1);
    expect(wait).toBeLessThanOrEqual(3600);
    // Any other refusal stays a plain 400 with no Retry-After, even in the same words.
    upload.mockResolvedValueOnce({ ok: false, message: line });
    expect((await POST(request())).status).toBe(400);
    upload.mockResolvedValueOnce({ ok: false, message: 'Full.' });
    const full = await POST(request());
    expect(full.status).toBe(400);
    expect(full.headers.get('retry-after')).toBeNull();
  });

  it('works out the wait from the fixed hourly window', () => {
    const hour = 60 * 60 * 1000;
    expect(uploadRetryAfterSeconds(10 * hour)).toBe(3600);
    expect(uploadRetryAfterSeconds(10 * hour + 59 * 60 * 1000)).toBe(60);
    expect(uploadRetryAfterSeconds(11 * hour - 1)).toBe(1);
  });

  it('answers the hourly limit by its refusal code, whatever its wording', async () => {
    upload.mockResolvedValueOnce({
      ok: false,
      message: 'You have added a lot of files this hour. Try again later.',
      refusal: 'rate_limited',
    });
    const limited = await POST(request());
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({
      message: 'You have added a lot of files this hour. Try again later.',
    });
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
  });
});
