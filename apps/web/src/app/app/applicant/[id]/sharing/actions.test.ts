import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  pauseGrant: vi.fn(),
  resumeGrant: vi.fn(),
  revokeGrant: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
  createGrant: vi.fn(),
  getAccountByEmail: vi.fn(),
  getPlatformCapabilities: vi.fn(),
}));
vi.mock('@visastack/services', async (original) => ({
  ...(await original<typeof import('@visastack/services')>()),
  pauseGrant: mocks.pauseGrant,
  resumeGrant: mocks.resumeGrant,
  revokeGrant: mocks.revokeGrant,
  createGrant: mocks.createGrant,
  getAccountByEmail: mocks.getAccountByEmail,
}));
vi.mock('../../../../../lib/capabilities', () => ({
  getPlatformCapabilities: mocks.getPlatformCapabilities,
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('../../../../../lib/jobs', () => ({ triggerNotificationWorker: vi.fn() }));
vi.mock('../../../../../lib/providers', () => ({ createKeyManagementPort: vi.fn() }));
vi.mock('../../../../../lib/step-up', () => ({
  STEP_UP_NOT_CONFIGURED_MESSAGE: 'Confirmation unavailable.',
  tryEstablishStepUp: vi.fn(),
}));
vi.mock('../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) => fn({ db: {}, accountId: 'owner' }),
}));
const { createGrantAction, updateGrantAction } = await import('./actions');
beforeEach(() => {
  vi.resetAllMocks();
  mocks.redirect.mockImplementation(() => {
    throw new Error('redirected');
  });
});
function form(op: string) {
  const data = new FormData();
  data.set('grantId', 'owned-grant');
  data.set('applicantId', 'untrusted-route');
  data.set('op', op);
  return data;
}
describe('sharing transition navigation', () => {
  it.each(['pause', 'resume', 'revoke'] as const)(
    '%s navigates to the committed grant owner route',
    async (op) => {
      const service = mocks[`${op}Grant`];
      service.mockResolvedValue({ ok: true, value: { applicantId: 'actual-applicant' } });
      expect(await updateGrantAction({ ok: true, message: '' }, form(op))).toEqual({
        ok: true,
        message: 'Access updated.',
        refreshPath: '/app/applicant/actual-applicant/sharing',
      });
      expect(service).toHaveBeenCalledWith({}, { actorAccountId: 'owner', grantId: 'owned-grant' });
      expect(mocks.redirect).not.toHaveBeenCalled();
    },
  );
  it('keeps service refusal visible without navigating', async () => {
    mocks.resumeGrant.mockResolvedValue({ ok: false, error: { message: 'Access has expired.' } });
    expect(await updateGrantAction({ ok: true, message: '' }, form('resume'))).toEqual({
      ok: false,
      message: 'Access has expired.',
    });
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe('the redacted copy permission follows the platform capability', () => {
  function grantForm(actions: readonly string[]) {
    const data = new FormData();
    data.set('applicantId', 'owned-person');
    data.set('recipientEmail', 'synthetic@example.com');
    data.set('purpose', 'Visa review');
    for (const action of actions) data.append('action', action);
    return data;
  }
  function capability(redactedDownload: 'available' | 'disabled') {
    mocks.getPlatformCapabilities.mockReturnValue({ redactedDownload });
  }
  beforeEach(() => {
    mocks.getAccountByEmail.mockResolvedValue({ id: 'recipient' });
    mocks.createGrant.mockResolvedValue({ ok: true, value: {} });
  });

  it('refuses a crafted request for redacted copies while they are not available', async () => {
    capability('disabled');
    const result = await createGrantAction(
      { ok: true, message: '' },
      grantForm(['VIEW_METADATA', 'PREVIEW', 'DOWNLOAD_REDACTED']),
    );
    expect(result).toEqual({
      ok: false,
      message: 'Downloading redacted copies is not available yet.',
    });
    expect(mocks.getAccountByEmail).not.toHaveBeenCalled();
    expect(mocks.createGrant).not.toHaveBeenCalled();
  });

  it('still shares the other permissions while redacted copies are not available', async () => {
    capability('disabled');
    const result = await createGrantAction(
      { ok: true, message: '' },
      grantForm(['VIEW_METADATA', 'PREVIEW']),
    );
    expect(result.ok).toBe(true);
    expect(mocks.createGrant).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ actions: ['VIEW_METADATA', 'PREVIEW'] }),
    );
  });

  it('grants redacted copies exactly as before once they are available', async () => {
    capability('available');
    const result = await createGrantAction(
      { ok: true, message: '' },
      grantForm(['VIEW_METADATA', 'PREVIEW', 'DOWNLOAD_REDACTED']),
    );
    expect(result).toEqual({
      ok: true,
      message: 'Access shared with synthetic@example.com. It becomes active once they accept.',
    });
    expect(mocks.createGrant).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ actions: ['VIEW_METADATA', 'PREVIEW', 'DOWNLOAD_REDACTED'] }),
    );
  });
});
