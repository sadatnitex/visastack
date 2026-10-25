import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * WP-V4 review: the request loader adds each answered file's newest state, read through the
 * central access gate one case (or one traveller) at a time. Its own file so the existing
 * console-data tests keep their setup unchanged.
 */
const svc = vi.hoisted(() => ({
  listEvidenceRequestsForOrgDetailed: vi.fn(),
  requireAccess: vi.fn(),
  listRespondingDocumentStatesForOrg: vi.fn(),
}));

vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  ...svc,
}));

const { loadEvidenceRequests } = await import('./console-data');

const db = {} as never;
const ok = <T>(value: T) => ({ ok: true as const, value });
const row = (overrides: Record<string, unknown>) => ({
  id: 'r',
  applicantId: 'ap1',
  missionId: 'm1',
  kind: 'DOCUMENT',
  status: 'RECEIVED',
  respondingDocumentId: 'd1',
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('loadEvidenceRequests: answered file state', () => {
  it('checks access once per case or traveller, and attaches only what the gate allowed', async () => {
    svc.listEvidenceRequestsForOrgDetailed.mockResolvedValue(
      ok([
        row({ id: 'r-case' }),
        row({ id: 'r-case-2', status: 'UNDER_REVIEW', respondingDocumentId: 'd2' }),
        row({ id: 'r-wide', missionId: null, respondingDocumentId: 'd3' }),
        row({ id: 'r-refused', missionId: 'm2', respondingDocumentId: 'd4' }),
        row({ id: 'r-open', status: 'OPEN', respondingDocumentId: null }),
        row({ id: 'r-field', kind: 'FIELD', respondingDocumentId: null }),
      ]),
    );
    svc.requireAccess.mockImplementation(async (_db, _principal, _action, ref) =>
      ref.missionId === 'm2'
        ? { ok: false, error: { code: 'forbidden' } }
        : ok({ proofFor: ref.missionId ?? ref.applicantId }),
    );
    svc.listRespondingDocumentStatesForOrg.mockImplementation(async (proof) =>
      proof.proofFor === 'm1'
        ? new Map([
            ['r-case', { processingStatus: 'AWAITING_REVIEW', safetyStatus: 'CLEAN' }],
            ['r-case-2', null],
          ])
        : new Map([['r-wide', { processingStatus: 'SCANNING', safetyStatus: 'PENDING' }]]),
    );

    const rows = await loadEvidenceRequests(db, 'acct', 'o1', { admin: true });
    const states = Object.fromEntries(
      rows.map((r) => [
        r.id,
        'respondingDocumentState' in r ? r.respondingDocumentState : 'absent',
      ]),
    );
    expect(states).toEqual({
      'r-case': { processingStatus: 'AWAITING_REVIEW', safetyStatus: 'CLEAN' },
      'r-case-2': null,
      'r-wide': { processingStatus: 'SCANNING', safetyStatus: 'PENDING' },
      'r-refused': 'absent',
      'r-open': 'absent',
      'r-field': 'absent',
    });
    expect(svc.requireAccess).toHaveBeenCalledTimes(3);
    for (const call of svc.requireAccess.mock.calls) {
      expect(call[2]).toBe('MANAGE');
      expect(call[4]).toMatchObject({ actingFor: { organizationId: 'o1' } });
    }
    expect(svc.listRespondingDocumentStatesForOrg).toHaveBeenCalledTimes(2);
  });

  it('reads nothing at all for someone who is not an administrator', async () => {
    expect(await loadEvidenceRequests(db, 'acct', 'o1', { admin: false })).toEqual([]);
    expect(svc.listEvidenceRequestsForOrgDetailed).not.toHaveBeenCalled();
    expect(svc.requireAccess).not.toHaveBeenCalled();
  });
});
