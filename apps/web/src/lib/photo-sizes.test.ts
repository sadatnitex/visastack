import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireAccess, EACH } = vi.hoisted(() => ({
  EACH: Symbol('each'),
  requireAccess: vi.fn(),
}));
vi.mock('./storage', () => ({ createStorage: () => ({}) }));
vi.mock('./step-up', () => ({ establishStepUpProof: vi.fn() }));
vi.mock('@visastack/adapters', () => ({ createPhotoSizer: () => ({}) }));
vi.mock('@visastack/services', () => ({
  EACH_GRANT: EACH,
  accountPrincipal: (accountId: string) => ({ kind: 'account', accountId }),
  requireAccess,
}));

const { mayUseVisaPhotoSizes } = await import('./photo-sizes');

beforeEach(() => requireAccess.mockReset());

describe('mayUseVisaPhotoSizes', () => {
  it('asks the gate the same safe-copy question as the photo routes', async () => {
    requireAccess.mockResolvedValue({ ok: true, value: {} });
    expect(await mayUseVisaPhotoSizes({} as never, 'acct', 'doc-1', 'individual')).toBe(true);
    expect(requireAccess).toHaveBeenCalledWith(
      {},
      { kind: 'account', accountId: 'acct' },
      'DOWNLOAD_REDACTED',
      { documentId: 'doc-1' },
      { purpose: EACH, actingFor: 'individual' },
    );
  });

  it('counts a restricted photo that only needs a fresh identity check, and nothing refused', async () => {
    requireAccess.mockResolvedValueOnce({ ok: false, error: { code: 'step_up_required' } });
    expect(await mayUseVisaPhotoSizes({} as never, 'acct', 'doc-1', undefined)).toBe(true);
    for (const code of ['forbidden', 'not_found', 'invalid']) {
      requireAccess.mockResolvedValueOnce({ ok: false, error: { code } });
      expect(await mayUseVisaPhotoSizes({} as never, 'acct', 'doc-1', undefined)).toBe(false);
    }
  });
});
