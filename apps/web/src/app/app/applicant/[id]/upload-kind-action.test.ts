import { MADE_UP_HEIC_SMALL } from '@visastack/adapters/testing';
import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getApplicant: vi.fn(),
  reserveUpload: vi.fn(),
  growUploadReservation: vi.fn(),
  requireAccess: vi.fn(),
  registerDocumentWithVersion: vi.fn(),
  failUpload: vi.fn(),
  finalizeUpload: vi.fn(),
  enqueueIntakeJob: vi.fn(),
  findDuplicateVersions: vi.fn(),
  putObject: vi.fn(),
  getObject: vi.fn(),
}));

vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  getApplicant: mocks.getApplicant,
  reserveUpload: mocks.reserveUpload,
  growUploadReservation: mocks.growUploadReservation,
  requireAccess: mocks.requireAccess,
  registerDocumentWithVersion: mocks.registerDocumentWithVersion,
  failUpload: mocks.failUpload,
  finalizeUpload: mocks.finalizeUpload,
  enqueueIntakeJob: mocks.enqueueIntakeJob,
  findDuplicateVersions: mocks.findDuplicateVersions,
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('next/server', () => ({ after: (fn: () => unknown) => void fn }));
vi.mock('../../../../lib/jobs', () => ({ triggerIntakeWorker: vi.fn() }));
vi.mock('../../../../lib/providers', () => ({
  createKeyManagementPort: () => undefined,
  createPreviewRenderer: () => undefined,
}));
vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: { db: object; accountId: string }) => unknown) =>
    fn({ db: {}, accountId: 'owner-1' }),
}));
vi.mock('../../../../lib/storage', () => ({
  createStorage: () => ({
    putObject: mocks.putObject,
    getObject: mocks.getObject,
    deleteObject: vi.fn(),
  }),
}));

const { uploadDocumentAction } = await import('./actions');

const initial = { ok: true, message: '' };
function upload(extra: Record<string, string>): FormData {
  const form = new FormData();
  form.set('applicantId', 'a-1');
  form.set(
    'file',
    new File(['Hello, this is a plain text note.'], 'note.txt', { type: 'text/plain' }),
  );
  for (const [key, value] of Object.entries(extra)) form.set(key, value);
  return form;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getApplicant.mockResolvedValue({ id: 'a-1', ownerAccountId: 'owner-1' });
  mocks.reserveUpload.mockImplementation(async (_db: unknown, input: { sizeBytes: number }) => ({
    ok: true,
    value: {
      id: `intent-${mocks.reserveUpload.mock.calls.length}`,
      objectKey: `key-${mocks.reserveUpload.mock.calls.length}`,
      reservedBytes: input.sizeBytes,
    },
  }));
  mocks.requireAccess.mockResolvedValue({ ok: true, value: { proof: 'owner of a-1' } });
  mocks.growUploadReservation.mockImplementation(
    async (_proof: unknown, input: { intentId: string; sizeBytes: number }) => ({
      ok: true,
      value: { id: input.intentId, objectKey: 'key-1', reservedBytes: input.sizeBytes },
    }),
  );
  mocks.putObject.mockResolvedValue(undefined);
  mocks.getObject.mockImplementation(async () => {
    const call = mocks.putObject.mock.calls[0]?.[0] as { bytes: Uint8Array } | undefined;
    return call ? { bytes: call.bytes } : null;
  });
  mocks.registerDocumentWithVersion.mockResolvedValue({
    ok: true,
    value: {
      version: { id: 'v-1', documentId: 'd-1', sha256: 'abc' },
      document: { id: 'd-1', approvedName: 'Passport, Nazmus', originalName: 'note.txt' },
    },
  });
  mocks.findDuplicateVersions.mockResolvedValue([]);
});

describe('a file identical to one already in the vault', () => {
  it("says so without naming the other document, whose name can hold a person's name", async () => {
    mocks.findDuplicateVersions.mockResolvedValueOnce([
      { documentId: 'd-0', displayName: 'Passport, Nazmus' },
    ]);
    const result = await uploadDocumentAction(initial, upload({}));
    expect(result.ok).toBe(true);
    expect(result.message).toContain('This looks identical to a document already in the vault.');
    expect(result.message).not.toContain('Nazmus');
  });
});

describe('choosing the kind of document when uploading', () => {
  it('stores the standard key for the chosen kind, and the name given to an Other kind', async () => {
    const result = await uploadDocumentAction(initial, upload({ docType: 'payslip' }));
    expect(result.ok).toBe(true);
    expect(mocks.registerDocumentWithVersion.mock.calls[0]?.[1]).toMatchObject({
      docType: 'SALARY_SLIP',
    });

    mocks.registerDocumentWithVersion.mockClear();
    await uploadDocumentAction(
      initial,
      upload({ docType: 'OTHER', subject: ' Marriage Certificate ' }),
    );
    expect(mocks.registerDocumentWithVersion.mock.calls[0]?.[1]).toMatchObject({
      docType: 'OTHER',
      subject: 'Marriage Certificate',
    });
  });

  it('still uploads when no kind is chosen, leaving it not set', async () => {
    const result = await uploadDocumentAction(initial, upload({ docType: '' }));
    expect(result.ok).toBe(true);
    const input = mocks.registerDocumentWithVersion.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(input).not.toHaveProperty('docType');
    expect(input).not.toHaveProperty('subject');
  });

  it('refuses an unknown kind on the kind field, before reserving space or storing anything', async () => {
    const result = await uploadDocumentAction(initial, upload({ docType: 'not a real kind' }));
    expect(result).toMatchObject({ ok: false, field: 'docType' });
    expect(mocks.reserveUpload).not.toHaveBeenCalled();
    expect(mocks.putObject).not.toHaveBeenCalled();
  });
});

describe('the name a new document is listed under', () => {
  it('asks for the automatic title and answers with it, never the file name', async () => {
    const result = await uploadDocumentAction(initial, upload({ docType: 'PASSPORT' }));
    expect(result).toMatchObject({ ok: true, title: 'Passport, Nazmus' });
    // The title is shown on screen but kept out of the message, which can end up in a log.
    expect(result.message).not.toContain('Nazmus');
    expect(mocks.registerDocumentWithVersion.mock.calls[0]?.[1]).toMatchObject({
      automaticTitle: true,
      source: 'UPLOAD',
      originalName: 'note.txt',
    });
  });
});

describe('an iPhone photo (HEIC)', () => {
  const heicUpload = (bytes: Uint8Array, name = 'IMG_2041.HEIC', type = 'image/heic') => {
    const form = new FormData();
    form.set('applicantId', 'a-1');
    form.set('file', new File([Buffer.from(bytes)], name, { type }));
    return form;
  };

  it('is stored as a new JPEG copy, recorded as converted, and the HEIC bytes are never stored', async () => {
    const result = await uploadDocumentAction(initial, heicUpload(MADE_UP_HEIC_SMALL));
    expect(result.ok).toBe(true);
    expect(result.message).toContain('saved as a JPG copy');
    expect(mocks.putObject).toHaveBeenCalledTimes(1);
    const stored = mocks.putObject.mock.calls[0]?.[0] as {
      bytes: Uint8Array;
      contentType: string;
      bucket: string;
    };
    expect(stored.contentType).toBe('image/jpeg');
    expect(stored.bucket).toBe('QUARANTINE');
    expect((await sharp(stored.bytes).metadata()).format).toBe('jpeg');
    expect(Buffer.from(stored.bytes).equals(Buffer.from(MADE_UP_HEIC_SMALL))).toBe(false);
    expect(mocks.registerDocumentWithVersion.mock.calls[0]?.[1]).toMatchObject({
      source: 'UPLOAD_CONVERTED_FROM_HEIC',
      originalName: 'IMG_2041.jpg',
      sizeBytes: stored.bytes.byteLength,
      automaticTitle: true,
    });
  });

  it('grows its own reservation in one step when the copy is larger than the photo sent', async () => {
    // As if the photo sent were smaller than its copy (the usual case: a JPEG is about twice a HEIC).
    mocks.reserveUpload.mockResolvedValueOnce({
      ok: true,
      value: { id: 'intent-1', objectKey: 'key-1', reservedBytes: 100 },
    });
    const result = await uploadDocumentAction(initial, heicUpload(MADE_UP_HEIC_SMALL));
    expect(result.ok).toBe(true);
    const stored = mocks.putObject.mock.calls[0]?.[0] as { bytes: Uint8Array; objectKey: string };
    expect(stored.bytes.byteLength).toBeGreaterThan(100);
    // One reservation attempt only (one charge against the upload rate limit), never released.
    expect(mocks.reserveUpload).toHaveBeenCalledTimes(1);
    expect(mocks.failUpload).not.toHaveBeenCalled();
    // Grown through the access gate, for this applicant, by the owner.
    expect(mocks.requireAccess).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ accountId: 'owner-1' }),
      'MANAGE',
      { applicantId: 'a-1' },
      { purpose: 'owner_document_upload' },
    );
    expect(mocks.growUploadReservation).toHaveBeenCalledWith(
      { proof: 'owner of a-1' },
      { intentId: 'intent-1', sizeBytes: stored.bytes.byteLength },
      expect.any(Object),
    );
    // The copy is stored under the same reservation's key and finishes that reservation.
    expect(stored.objectKey).toBe('key-1');
    expect(mocks.finalizeUpload).toHaveBeenCalledWith({}, 'intent-1', 'v-1');
  });

  it('stores nothing and lets the reservation go when there is no room for the larger copy', async () => {
    mocks.reserveUpload.mockResolvedValueOnce({
      ok: true,
      value: { id: 'intent-1', objectKey: 'key-1', reservedBytes: 100 },
    });
    mocks.growUploadReservation.mockResolvedValueOnce({
      ok: false,
      error: { code: 'invalid', message: 'this applicant has reached its 50 MB evidence limit' },
    });
    const result = await uploadDocumentAction(initial, heicUpload(MADE_UP_HEIC_SMALL));
    expect(result).toMatchObject({
      ok: false,
      message:
        'The converted copy does not fit in the storage space left. This applicant has reached its 50 MB evidence limit.',
    });
    expect(mocks.putObject).not.toHaveBeenCalled();
    expect(mocks.reserveUpload).toHaveBeenCalledTimes(1);
    expect(mocks.failUpload).toHaveBeenCalledWith(
      {},
      'intent-1',
      'converted copy: applicant evidence limit',
    );
  });

  it('says plainly when the converted copy is larger than the per-file limit', async () => {
    mocks.reserveUpload.mockResolvedValueOnce({
      ok: true,
      value: { id: 'intent-1', objectKey: 'key-1', reservedBytes: 100 },
    });
    mocks.growUploadReservation.mockResolvedValueOnce({
      ok: false,
      error: { code: 'invalid', message: 'file exceeds the 20 MB upload limit' },
    });
    const result = await uploadDocumentAction(initial, heicUpload(MADE_UP_HEIC_SMALL));
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/^The converted copy is larger than the [\d.]+ MB limit\./);
    expect(mocks.failUpload).toHaveBeenCalledWith(
      {},
      'intent-1',
      'converted copy: larger than the per-file limit',
    );
  });

  it('records why a reservation could not grow when the upload is no longer in progress', async () => {
    mocks.reserveUpload.mockResolvedValueOnce({
      ok: true,
      value: { id: 'intent-1', objectKey: 'key-1', reservedBytes: 100 },
    });
    mocks.growUploadReservation.mockResolvedValueOnce({
      ok: false,
      error: { code: 'not_found', message: 'this upload is no longer in progress' },
    });
    const result = await uploadDocumentAction(initial, heicUpload(MADE_UP_HEIC_SMALL));
    expect(result).toMatchObject({
      ok: false,
      message: 'This upload took too long and was stopped. Try again.',
    });
    expect(mocks.failUpload).toHaveBeenCalledWith(
      {},
      'intent-1',
      'converted copy: reservation no longer active',
    );
  });

  it('keeps its reservation when the copy fits in it', async () => {
    await uploadDocumentAction(initial, heicUpload(MADE_UP_HEIC_SMALL));
    expect(mocks.reserveUpload).toHaveBeenCalledTimes(1);
    expect(mocks.growUploadReservation).not.toHaveBeenCalled();
    expect(mocks.failUpload).not.toHaveBeenCalled();
  });

  it('is converted when the browser sent it with no type, and refused when it cannot be read', async () => {
    const untyped = await uploadDocumentAction(
      initial,
      heicUpload(MADE_UP_HEIC_SMALL, 'photo', ''),
    );
    expect(untyped.ok).toBe(true);
    expect((mocks.putObject.mock.calls[0]?.[0] as { contentType: string }).contentType).toBe(
      'image/jpeg',
    );

    mocks.putObject.mockClear();
    const broken = await uploadDocumentAction(
      initial,
      heicUpload(MADE_UP_HEIC_SMALL.subarray(0, 40)),
    );
    expect(broken).toMatchObject({ ok: false });
    expect(broken.message).toContain('could not read this iPhone photo');
    expect(mocks.putObject).not.toHaveBeenCalled();
    expect(mocks.failUpload).toHaveBeenCalledWith({}, expect.any(String), 'heic unreadable');

    // Something that only claims to be a HEIC is refused the same way.
    const pretend = await uploadDocumentAction(
      initial,
      heicUpload(new TextEncoder().encode('MZ not a photo at all, just text'), 'x.heic'),
    );
    expect(pretend.ok).toBe(false);
    expect(mocks.putObject).not.toHaveBeenCalled();
  });
});
