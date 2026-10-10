import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  applicant: vi.fn(),
  download: vi.fn(),
  stepUp: vi.fn(),
  capabilities: vi.fn(),
}));
vi.mock('@visastack/services', () => ({
  getApplicant: mocks.applicant,
  downloadDocument: mocks.download,
}));
vi.mock('../../../../lib/capabilities', () => ({ getPlatformCapabilities: mocks.capabilities }));
vi.mock('../../../../lib/step-up', () => ({ establishStepUp: mocks.stepUp }));
vi.mock('../../../../lib/storage', () => ({ createStorage: () => ({}) }));
vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: { db: object; accountId: string }) => unknown) =>
    fn({ db: {}, accountId: 'owner-test' }),
}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));

const applicantId = '00000000-0000-4000-8000-000000000001';
const documentId = '00000000-0000-4000-8000-000000000002';
function input() {
  const form = new FormData();
  form.set('applicantId', applicantId);
  form.set('documentId', documentId);
  return form;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('BLOB_SIGNING_SECRET', 'test-only-signing-key');
  mocks.capabilities.mockReturnValue({ originalDownload: 'available' });
  mocks.applicant.mockResolvedValue({ ownerAccountId: 'owner-test' });
  mocks.stepUp.mockResolvedValue({ satisfied: true });
  mocks.download.mockResolvedValue({
    ok: true,
    value: { url: 'https://preview.example.test/api/blob/object?sig=test-only' },
  });
});

it('denies another owner before requesting authentication or delivery', async () => {
  mocks.applicant.mockResolvedValue({ ownerAccountId: 'another-owner' });
  const { downloadOriginalAction } = await import('./download-actions');
  await expect(downloadOriginalAction(input())).rejects.toThrow('download_error=1');
  expect(mocks.stepUp).not.toHaveBeenCalled();
  expect(mocks.download).not.toHaveBeenCalled();
}, 30_000);

it('ignores client assurance and requires fresh authentication bound to this document', async () => {
  mocks.stepUp.mockResolvedValue({ satisfied: false, reauthUrl: '/auth/reauth' });
  const form = input();
  form.set('stepUpSatisfied', 'true');
  const { downloadOriginalAction } = await import('./download-actions');
  await expect(downloadOriginalAction(form)).rejects.toThrow('REDIRECT:/auth/reauth');
  expect(mocks.stepUp).toHaveBeenCalledWith(
    { accountId: 'owner-test', action: 'DOWNLOAD_ORIGINAL', resourceId: documentId },
    `/app/applicant/${applicantId}/documents`,
  );
  expect(mocks.download).not.toHaveBeenCalled();
});

it('uses original-download policy and delivers through the current deployment', async () => {
  const { downloadOriginalAction } = await import('./download-actions');
  await expect(downloadOriginalAction(input())).rejects.toThrow(
    'REDIRECT:/api/blob/object?sig=test-only',
  );
  expect(mocks.download).toHaveBeenCalledWith(
    {},
    {},
    expect.objectContaining({ documentId, variant: 'original', stepUpSatisfied: true }),
  );
});

it('never redirects to a raw upstream storage URL', async () => {
  mocks.download.mockResolvedValue({
    ok: true,
    value: { url: 'https://storage.example.test/private-file' },
  });
  const { downloadOriginalAction } = await import('./download-actions');
  await expect(downloadOriginalAction(input())).rejects.toThrow('download_error=1');
});

it('rejects malformed identifiers without looking up an account', async () => {
  const form = input();
  form.set('applicantId', '../../other');
  const { downloadOriginalAction } = await import('./download-actions');
  await expect(downloadOriginalAction(form)).rejects.toThrow('REDIRECT:/app');
  expect(mocks.applicant).not.toHaveBeenCalled();
});
