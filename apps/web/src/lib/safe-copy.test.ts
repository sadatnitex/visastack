import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireAccess, listStates, EACH } = vi.hoisted(() => ({
  EACH: Symbol('each'),
  requireAccess: vi.fn(),
  listStates: vi.fn(),
}));
vi.mock('./storage', () => ({ createStorage: () => ({}) }));
vi.mock('./step-up', () => ({ establishStepUpProof: vi.fn() }));
vi.mock('./providers', () => ({ createKeyManagementPort: () => undefined }));
vi.mock('./capabilities', () => ({
  getPlatformCapabilities: () => ({ redactedDownload: 'available' }),
}));
vi.mock('@visastack/adapters', () => ({ createSafeCopyRenderer: () => ({}) }));
vi.mock('@visastack/services', () => ({
  EACH_GRANT: EACH,
  accountPrincipal: (accountId: string) => ({ kind: 'account', accountId }),
  requireAccess,
  listSafeCopyStatesForDocuments: listStates,
  isSafeCopyReady: (state: string) => state === 'MASKED' || state === 'NOTHING_TO_HIDE',
}));

const { safeCopyOffers, safeCopyErrorResponse } = await import('./safe-copy');

const ok = (proof: string) => ({ ok: true, value: { proof } });
const refused = (code: string) => ({ ok: false, error: { code } });

beforeEach(() => {
  requireAccess.mockReset();
  listStates.mockReset();
});

describe('safeCopyOffers', () => {
  it('reads every state in one go from view-details proofs, asking for nothing extra', async () => {
    // Per document: view details, then download safe copies.
    const access: Record<string, [unknown, unknown]> = {
      ready: [ok('v-ready'), ok('d-ready')],
      restricted: [ok('v-restricted'), refused('step_up_required')],
      waiting: [ok('v-waiting'), refused('step_up_required')],
      preparing: [ok('v-preparing'), ok('d-preparing')],
      docx: [ok('v-docx'), ok('d-docx')],
      hidden: [ok('v-hidden'), refused('forbidden')],
    };
    requireAccess.mockImplementation(
      async (_db, _p, action: string, ref: { documentId: string }) => {
        const pair = access[ref.documentId];
        return action === 'VIEW_METADATA' ? pair?.[0] : pair?.[1];
      },
    );
    listStates.mockResolvedValue(
      new Map([
        ['ready', 'MASKED'],
        ['restricted', 'NOTHING_TO_HIDE'],
        ['waiting', 'NOT_PREPARED'],
        ['preparing', 'PREPARING'],
        ['docx', 'UNSUPPORTED'],
      ]),
    );
    const offers = await safeCopyOffers({} as never, 'acct', Object.keys(access), 'individual');
    expect(Object.fromEntries(offers)).toEqual({
      ready: 'ready',
      restricted: 'confirm',
      waiting: 'not_prepared',
      preparing: 'not_prepared',
      docx: 'not_available',
      hidden: 'none',
    });
    // One state read for all of them, never for a document the viewer may not download.
    expect(listStates).toHaveBeenCalledTimes(1);
    const [firstProof, rest] = listStates.mock.calls[0] ?? [];
    expect([firstProof, ...(rest as unknown[])]).toEqual([
      { proof: 'v-ready' },
      { proof: 'v-restricted' },
      { proof: 'v-waiting' },
      { proof: 'v-preparing' },
      { proof: 'v-docx' },
    ]);
    expect(requireAccess.mock.calls[0]?.[4]).toEqual({ purpose: EACH, actingFor: 'individual' });
  });

  it('offers the button behind an identity check when the state cannot be read without one', async () => {
    requireAccess.mockImplementation(async (_db, _p, action: string) =>
      action === 'VIEW_METADATA' ? refused('forbidden') : refused('step_up_required'),
    );
    const offers = await safeCopyOffers({} as never, 'acct', ['doc'], undefined);
    expect(offers.get('doc')).toBe('confirm');
    expect(listStates).not.toHaveBeenCalled();
  });

  it('never repeats an internal reason to the viewer', async () => {
    const response = safeCopyErrorResponse({ code: 'forbidden', message: 'action_not_granted' });
    expect(response.status).toBe(403);
    expect(JSON.stringify(await response.json())).not.toContain('action_not_granted');
  });
});
