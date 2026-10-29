import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireAccess, getSafeCopyState, EACH } = vi.hoisted(() => ({
  EACH: Symbol('each'),
  requireAccess: vi.fn(),
  getSafeCopyState: vi.fn(),
}));
vi.mock('./storage', () => ({ createStorage: () => ({}) }));
vi.mock('./step-up', () => ({ establishStepUpProof: vi.fn() }));
vi.mock('./providers', () => ({ createKeyManagementPort: () => undefined }));
vi.mock('@visastack/adapters', () => ({ createSafeCopyRenderer: () => ({}) }));
vi.mock('@visastack/services', () => ({
  EACH_GRANT: EACH,
  accountPrincipal: (accountId: string) => ({ kind: 'account', accountId }),
  requireAccess,
  getSafeCopyState,
}));

const { safeCopyOffer, safeCopyErrorResponse } = await import('./safe-copy');

beforeEach(() => {
  requireAccess.mockReset();
  getSafeCopyState.mockReset();
});

describe('safeCopyOffer', () => {
  it('asks the gate the same question as the safe copy route, then reads the state', async () => {
    requireAccess.mockResolvedValue({ ok: true, value: { proof: true } });
    getSafeCopyState.mockResolvedValue({ ok: true, value: 'MASKED' });
    expect(await safeCopyOffer({} as never, 'acct', 'doc-1', 'individual')).toBe('ready');
    expect(requireAccess).toHaveBeenCalledWith(
      {},
      { kind: 'account', accountId: 'acct' },
      'DOWNLOAD_REDACTED',
      { documentId: 'doc-1' },
      { purpose: EACH, actingFor: 'individual' },
    );
    expect(getSafeCopyState).toHaveBeenCalledWith({ proof: true });
    getSafeCopyState.mockResolvedValue({ ok: true, value: 'NOTHING_TO_HIDE' });
    expect(await safeCopyOffer({} as never, 'acct', 'doc-1', undefined)).toBe('ready');
    for (const state of ['NOT_PREPARED', 'UNSUPPORTED', 'TOO_LARGE']) {
      getSafeCopyState.mockResolvedValue({ ok: true, value: state });
      expect(await safeCopyOffer({} as never, 'acct', 'doc-1', undefined)).toBe('not_prepared');
    }
  });

  it('offers the button for a fresh identity check, and nothing for any refusal', async () => {
    requireAccess.mockResolvedValueOnce({ ok: false, error: { code: 'step_up_required' } });
    expect(await safeCopyOffer({} as never, 'acct', 'doc-1', undefined)).toBe('confirm');
    for (const code of ['forbidden', 'not_found', 'invalid']) {
      requireAccess.mockResolvedValueOnce({ ok: false, error: { code } });
      expect(await safeCopyOffer({} as never, 'acct', 'doc-1', undefined)).toBe('none');
    }
    expect(getSafeCopyState).not.toHaveBeenCalled();
  });

  it('never repeats an internal reason to the viewer', async () => {
    const response = safeCopyErrorResponse({ code: 'forbidden', message: 'action_not_granted' });
    expect(response.status).toBe(403);
    expect(JSON.stringify(await response.json())).not.toContain('action_not_granted');
  });
});
