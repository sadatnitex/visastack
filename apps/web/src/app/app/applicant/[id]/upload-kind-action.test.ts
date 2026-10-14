import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getApplicant: vi.fn(),
  reserveUpload: vi.fn(),
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
  mocks.reserveUpload.mockResolvedValue({
    ok: true,
    value: { id: 'intent-1', objectKey: 'key-1' },
  });
  mocks.putObject.mockResolvedValue(undefined);
  mocks.getObject.mockImplementation(async () => {
    const call = mocks.putObject.mock.calls[0]?.[0] as { bytes: Uint8Array } | undefined;
    return call ? { bytes: call.bytes } : null;
  });
  mocks.registerDocumentWithVersion.mockResolvedValue({
    ok: true,
    value: { version: { id: 'v-1', documentId: 'd-1', sha256: 'abc' } },
  });
  mocks.findDuplicateVersions.mockResolvedValue([]);
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
