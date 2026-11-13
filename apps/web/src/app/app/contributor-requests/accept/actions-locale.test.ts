import { keyedError } from '@visastack/services';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ locale: 'en' as 'en' | 'bn' }));
const mocks = vi.hoisted(() => ({
  beginContributorSubmission: vi.fn(),
  abandonContributorSubmission: vi.fn(),
  reserveUpload: vi.fn(),
  registerDocumentWithVersion: vi.fn(),
  failUpload: vi.fn(),
  putObject: vi.fn(),
  getObject: vi.fn(),
}));
vi.mock('../../../../lib/locale', () => ({ getLocale: async () => state.locale }));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  beginContributorSubmission: mocks.beginContributorSubmission,
  abandonContributorSubmission: mocks.abandonContributorSubmission,
  reserveUpload: mocks.reserveUpload,
  registerDocumentWithVersion: mocks.registerDocumentWithVersion,
  failUpload: mocks.failUpload,
}));
vi.mock('next/server', () => ({ after: (fn: () => unknown) => void fn }));
vi.mock('../../../api/jobs/process-ai-reading/run', () => ({ triggerIntakeAndReading: vi.fn() }));
vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'c-1', email: 'c@example.test' }),
}));
vi.mock('../../../../lib/storage', () => ({
  createStorage: () => ({
    putObject: mocks.putObject,
    getObject: mocks.getObject,
    deleteObject: vi.fn(async () => undefined),
  }),
}));

const { submitContributorEvidenceAction } = await import('./actions');

const ENGLISH = 'Core processing consent is required';
const BENGALI = /[ঀ-৿]/;
const initial = { ok: false, message: '' };

function form() {
  const data = new FormData();
  data.set('token', 'tok');
  data.set('file', new File(['hello'], 'a.txt', { type: 'text/plain' }));
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.locale = 'en';
  mocks.beginContributorSubmission.mockResolvedValue({
    ok: true,
    value: { id: 'r-1', applicantId: 'ap-1', docType: 'PASSPORT' },
  });
  mocks.reserveUpload.mockResolvedValue({
    ok: true,
    value: { id: 'i-1', objectKey: 'k-1', reservedBytes: 5 },
  });
  mocks.putObject.mockResolvedValue(undefined);
  mocks.getObject.mockResolvedValue({ bytes: new Uint8Array(5) });
  mocks.registerDocumentWithVersion.mockResolvedValue({
    ok: false,
    error: keyedError('consent_required', 'documents.coreProcessingConsentIsRequired'),
  });
});

describe('contributor upload refusals show in the visitor language', () => {
  it('under en the exact English, under bn the Bangla (upload consent)', async () => {
    expect(await submitContributorEvidenceAction(initial, form())).toEqual({
      ok: false,
      message: ENGLISH,
    });
    state.locale = 'bn';
    const shown = await submitContributorEvidenceAction(initial, form());
    expect(shown.message).toMatch(BENGALI);
    expect(shown.message).not.toBe(ENGLISH);
    // Support still gets the English reason.
    expect(mocks.failUpload).toHaveBeenLastCalledWith({}, 'i-1', ENGLISH);
  });

  it('a refused reservation is worded the same way', async () => {
    mocks.reserveUpload.mockResolvedValue({
      ok: false,
      error: keyedError('not_found', 'documents.applicantNotFound'),
    });
    state.locale = 'bn';
    expect(await submitContributorEvidenceAction(initial, form())).toEqual({
      ok: false,
      message: 'applicant not found',
    });
  });
});
