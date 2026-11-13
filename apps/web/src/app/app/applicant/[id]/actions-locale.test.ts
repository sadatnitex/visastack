import { keyedError } from '@visastack/services';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ locale: 'en' as 'en' | 'bn' }));
const mocks = vi.hoisted(() => ({
  getApplicant: vi.fn(),
  reserveUpload: vi.fn(),
  requireAccess: vi.fn(),
  registerDocumentWithVersion: vi.fn(),
  failUpload: vi.fn(),
  renameDocument: vi.fn(),
  setDocumentExpiry: vi.fn(),
  findDuplicateVersions: vi.fn(),
  putObject: vi.fn(),
  getObject: vi.fn(),
}));
vi.mock('../../../../lib/locale', () => ({ getLocale: async () => state.locale }));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  getApplicant: mocks.getApplicant,
  reserveUpload: mocks.reserveUpload,
  requireAccess: mocks.requireAccess,
  registerDocumentWithVersion: mocks.registerDocumentWithVersion,
  failUpload: mocks.failUpload,
  renameDocument: mocks.renameDocument,
  setDocumentExpiry: mocks.setDocumentExpiry,
  findDuplicateVersions: mocks.findDuplicateVersions,
}));
vi.mock('../../../../lib/field-registry', () => ({
  ensureDocumentFieldsRegistered: async () => 0,
}));
vi.mock('../../../../lib/server-error', () => ({ reportServerError: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/server', () => ({ after: (fn: () => unknown) => void fn }));
vi.mock('../../../../lib/jobs', () => ({ triggerIntakeWorker: vi.fn() }));
vi.mock('../../../../lib/providers', () => ({ createKeyManagementPort: () => undefined }));
vi.mock('../../../../lib/providers-media', () => ({ createPreviewRenderer: () => undefined }));
vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: { db: object; accountId: string }) => unknown) =>
    fn({ db: {}, accountId: 'owner-1' }),
}));
vi.mock('../../../../lib/storage', () => ({
  createStorage: () => ({
    putObject: mocks.putObject,
    getObject: mocks.getObject,
    deleteObject: vi.fn(async () => undefined),
  }),
}));

const { renameDocumentAction, setDocumentExpiryAction, uploadDocumentAction } = await import(
  './actions'
);

const BENGALI = /[ঀ-৿]/;
const CONSENT = 'Core processing consent is required';
const PURGE =
  'this document has a retention purge in progress and cannot be modified until it completes';
const initial = { ok: true, message: '' };
const proof = { applicant: { id: 'a-1' } };

function upload(): FormData {
  const data = new FormData();
  data.set('applicantId', 'a-1');
  data.set('file', new File(['Hello, a plain note.'], 'note.txt', { type: 'text/plain' }));
  return data;
}
function docForm(fields: Record<string, string>): FormData {
  const data = new FormData();
  data.set('applicantId', 'a-1');
  data.set('documentId', 'd-1');
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.locale = 'en';
  mocks.getApplicant.mockResolvedValue({ id: 'a-1', ownerAccountId: 'owner-1' });
  mocks.reserveUpload.mockResolvedValue({
    ok: true,
    value: { id: 'i-1', objectKey: 'k-1', reservedBytes: 20 },
  });
  mocks.requireAccess.mockResolvedValue({ ok: true, value: proof });
  mocks.putObject.mockResolvedValue(undefined);
  mocks.getObject.mockImplementation(async () => {
    const call = mocks.putObject.mock.calls[0]?.[0] as { bytes: Uint8Array } | undefined;
    return call ? { bytes: call.bytes } : null;
  });
  mocks.findDuplicateVersions.mockResolvedValue([]);
  mocks.registerDocumentWithVersion.mockResolvedValue({
    ok: false,
    error: keyedError('consent_required', 'documents.coreProcessingConsentIsRequired'),
  });
  const purge = {
    ok: false,
    error: keyedError('invalid', 'documents.thisDocumentHasARetentionPurge'),
  };
  mocks.renameDocument.mockResolvedValue(purge);
  mocks.setDocumentExpiry.mockResolvedValue(purge);
});

describe('document screens word refusals in the visitor language', () => {
  it('upload consent: exact English under en, Bangla under bn', async () => {
    expect((await uploadDocumentAction(initial, upload())).message).toBe(CONSENT);
    state.locale = 'bn';
    const shown = await uploadDocumentAction(initial, upload());
    expect(shown.message).toMatch(BENGALI);
    expect(shown.message).not.toBe(CONSENT);
  });

  it('rename during a retention purge: English sentence under en, Bangla with the Bangla stop under bn', async () => {
    const form = docForm({ name: 'New name' });
    expect((await renameDocumentAction(initial, form)).message).toBe(
      'This document has a retention purge in progress and cannot be modified until it completes.',
    );
    state.locale = 'bn';
    const shown = (await renameDocumentAction(initial, form)).message;
    expect(shown).toMatch(BENGALI);
    expect(shown.endsWith('।')).toBe(true);
    expect(shown.endsWith('.')).toBe(false);
  });

  it('saving an expiry during a retention purge: English under en, Bangla under bn', async () => {
    const form = docForm({ expiresOn: '2031-04-30' });
    expect((await setDocumentExpiryAction(initial, form)).message).toBe(
      `${PURGE.charAt(0).toUpperCase()}${PURGE.slice(1)}.`,
    );
    state.locale = 'bn';
    const shown = (await setDocumentExpiryAction(initial, form)).message;
    expect(shown).toMatch(BENGALI);
    expect(shown.endsWith('।')).toBe(true);
  });
});
