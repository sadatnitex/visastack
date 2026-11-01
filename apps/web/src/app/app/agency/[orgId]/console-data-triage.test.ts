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
  referenceCodesFor: vi.fn(),
  getDocumentLifecycles: vi.fn(),
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
  svc.referenceCodesFor.mockResolvedValue(new Map());
  svc.getDocumentLifecycles.mockResolvedValue(new Map());
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

    const rows = await loadEvidenceRequests(
      db,
      'acct',
      'o1',
      { admin: true },
      { withFileStates: true },
    );
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

  it('looks up no file state unless the screen asks for it', async () => {
    svc.listEvidenceRequestsForOrgDetailed.mockResolvedValue(ok([row({ id: 'r-case' })]));
    const rows = await loadEvidenceRequests(db, 'acct', 'o1', { admin: true });
    expect(rows.map((r) => r.id)).toEqual(['r-case']);
    expect('respondingDocumentState' in (rows[0] ?? {})).toBe(false);
    expect(svc.requireAccess).not.toHaveBeenCalled();
    expect(svc.listRespondingDocumentStatesForOrg).not.toHaveBeenCalled();
  });

  it('reads nothing at all for someone who is not an administrator', async () => {
    expect(await loadEvidenceRequests(db, 'acct', 'o1', { admin: false })).toEqual([]);
    expect(svc.listEvidenceRequestsForOrgDetailed).not.toHaveBeenCalled();
    expect(svc.requireAccess).not.toHaveBeenCalled();
  });
});

describe('loadEvidenceRequests: answered file lifecycle (lane Z)', () => {
  const lifecycle = (state: string, extra: Record<string, unknown> = {}) => ({
    state,
    replaced: false,
    archivedAt: null,
    deletedAt: null,
    purgeAfter: null,
    deletePath: null,
    ...extra,
  });

  it('labels an archived or removed answered file with the same proof, never by name', async () => {
    svc.listEvidenceRequestsForOrgDetailed.mockResolvedValue(
      ok([
        row({ id: 'r-archived', respondingDocumentId: 'd1' }),
        row({ id: 'r-removed', respondingDocumentId: 'd2' }),
        row({ id: 'r-current', respondingDocumentId: 'd3' }),
        row({ id: 'r-refused', missionId: 'm2', respondingDocumentId: 'd4' }),
      ]),
    );
    svc.requireAccess.mockImplementation(async (_db, _principal, _action, ref) =>
      ref.missionId === 'm2'
        ? { ok: false, error: { code: 'forbidden' } }
        : ok({ proofFor: ref.missionId }),
    );
    svc.listRespondingDocumentStatesForOrg.mockResolvedValue(new Map());
    svc.getDocumentLifecycles.mockResolvedValue(
      new Map([
        ['d1', lifecycle('ARCHIVED')],
        [
          'd2',
          lifecycle('REMOVING', {
            deletedAt: new Date('2026-11-03T10:00:00Z'),
            deletePath: 'REQUEST',
          }),
        ],
        ['d3', lifecycle('CURRENT')],
      ]),
    );
    const rows = await loadEvidenceRequests(
      db,
      'acct',
      'o1',
      { admin: true },
      { withFileStates: true },
    );
    const labels = Object.fromEntries(rows.map((r) => [r.id, r.respondingDocumentLabel ?? null]));
    expect(labels['r-archived']).toBe('Archived');
    expect(labels['r-removed']).toMatch(/^Removed by the traveller on 3 Nov/);
    expect(labels['r-current']).toBeNull();
    expect(labels['r-refused']).toBeNull();
    // Only the case the gate allowed was read, with that case's proof and its own files.
    expect(svc.getDocumentLifecycles).toHaveBeenCalledTimes(1);
    expect(svc.getDocumentLifecycles.mock.calls[0]?.[1]).toEqual(['d1', 'd2', 'd3']);
    expect(svc.getDocumentLifecycles.mock.calls[0]?.[2]).toEqual({ proofFor: 'm1' });
  });
});
