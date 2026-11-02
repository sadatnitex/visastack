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
  claimUploadReceipt: vi.fn(),
  attachUploadIntent: vi.fn(),
  completeUploadReceipt: vi.fn(),
  releaseUploadReceipt: vi.fn(),
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
  claimUploadReceipt: mocks.claimUploadReceipt,
  attachUploadIntent: mocks.attachUploadIntent,
  completeUploadReceipt: mocks.completeUploadReceipt,
  releaseUploadReceipt: mocks.releaseUploadReceipt,
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
  mocks.claimUploadReceipt.mockResolvedValue({
    kind: 'claimed',
    receiptId: 'r-1',
    claimToken: 't-1',
  });
  mocks.completeUploadReceipt.mockResolvedValue(true);
});

const UPLOAD_ID = '0b9f8c1e-2d3a-4c5b-8e7f-6a5b4c3d2e1f';

describe('the upload id (UMPE P3, ledger I16)', () => {
  it('answers a repeat of a stored upload with its document, reserving and storing nothing', async () => {
    mocks.claimUploadReceipt.mockResolvedValueOnce({
      kind: 'replay',
      documentId: 'd-1',
      documentVersionId: 'v-1',
      title: 'Passport, Nazmus',
      uploadIntentId: 'intent-0',
    });
    const result = await uploadDocumentAction(
      initial,
      upload({ uploadId: UPLOAD_ID, originalFileName: 'passport.jpg' }),
    );
    expect(result).toMatchObject({ ok: true, title: 'Passport, Nazmus' });
    expect(result.message).toBe('This file was already added, so it was not added again.');
    expect(mocks.claimUploadReceipt.mock.calls[0]?.[1]).toEqual({
      uploadId: UPLOAD_ID,
      originalFileName: 'passport.jpg',
    });
    expect(mocks.reserveUpload).not.toHaveBeenCalled();
    expect(mocks.putObject).not.toHaveBeenCalled();
    expect(mocks.registerDocumentWithVersion).not.toHaveBeenCalled();
    // What the first attempt may not have finished is finished now: reading queued, reservation
    // closed, both safe to repeat.
    expect(mocks.enqueueIntakeJob.mock.calls[0]?.[1]).toEqual({ documentVersionId: 'v-1' });
    expect(mocks.finalizeUpload.mock.calls[0]?.slice(1)).toEqual(['intent-0', 'v-1']);
  });

  it('tells a repeat still being stored to wait, and refuses an id used for another person', async () => {
    mocks.claimUploadReceipt.mockResolvedValueOnce({ kind: 'in_progress', retryAfterSeconds: 87 });
    expect(await uploadDocumentAction(initial, upload({ uploadId: UPLOAD_ID }))).toMatchObject({
      ok: false,
      refusal: 'in_progress',
      retryAfterSeconds: 87,
    });
    mocks.claimUploadReceipt.mockResolvedValueOnce({ kind: 'conflict' });
    expect(await uploadDocumentAction(initial, upload({ uploadId: UPLOAD_ID }))).toMatchObject({
      ok: false,
      refusal: 'upload_conflict',
    });
    expect(mocks.reserveUpload).not.toHaveBeenCalled();
  });

  it('completes the receipt with the stored document before the reading is queued', async () => {
    const order: string[] = [];
    mocks.completeUploadReceipt.mockImplementationOnce(async () => {
      order.push('complete');
      return true;
    });
    mocks.enqueueIntakeJob.mockImplementationOnce(async () => {
      order.push('enqueue');
    });
    const result = await uploadDocumentAction(initial, upload({ uploadId: UPLOAD_ID }));
    expect(result.ok).toBe(true);
    expect(mocks.attachUploadIntent.mock.calls[0]?.[1]).toMatchObject({
      receiptId: 'r-1',
      claimToken: 't-1',
      uploadIntentId: 'intent-1',
    });
    expect(mocks.completeUploadReceipt.mock.calls[0]?.[1]).toMatchObject({
      receiptId: 'r-1',
      claimToken: 't-1',
      documentId: 'd-1',
      documentVersionId: 'v-1',
    });
    expect(order).toEqual(['complete', 'enqueue']);
    expect(mocks.releaseUploadReceipt).not.toHaveBeenCalled();
  });

  it('lets go of the claim when nothing was stored, so Try Again with the same id works', async () => {
    mocks.putObject.mockRejectedValueOnce(new Error('storage down'));
    const result = await uploadDocumentAction(initial, upload({ uploadId: UPLOAD_ID }));
    expect(result.ok).toBe(false);
    expect(mocks.releaseUploadReceipt.mock.calls[0]?.[1]).toMatchObject({
      receiptId: 'r-1',
      claimToken: 't-1',
    });
    expect(mocks.completeUploadReceipt).not.toHaveBeenCalled();

    mocks.reserveUpload.mockResolvedValueOnce({
      ok: false,
      error: { code: 'quota_exceeded', message: 'Full.' },
    });
    await uploadDocumentAction(initial, upload({ uploadId: UPLOAD_ID }));
    expect(mocks.releaseUploadReceipt).toHaveBeenCalledTimes(2);
  });

  it('uploads exactly as before without an id', async () => {
    const result = await uploadDocumentAction(initial, upload({}));
    expect(result.ok).toBe(true);
    expect(mocks.claimUploadReceipt).not.toHaveBeenCalled();
    expect(mocks.completeUploadReceipt).not.toHaveBeenCalled();
  });

  it('releases the reservation and the claim when recording the reservation fails', async () => {
    mocks.attachUploadIntent.mockRejectedValueOnce(new Error('database hiccup'));
    const result = await uploadDocumentAction(initial, upload({ uploadId: UPLOAD_ID }));
    expect(result.ok).toBe(false);
    expect(mocks.failUpload).toHaveBeenCalled();
    expect(mocks.releaseUploadReceipt).toHaveBeenCalledTimes(1);
    expect(mocks.putObject).not.toHaveBeenCalled();
  });
});
