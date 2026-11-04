import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAccess: vi.fn(),
  listEvidenceSubmissions: vi.fn(),
  loadVersionScanEvidence: vi.fn(),
  reportServerError: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  accountPrincipal: (accountId: string) => ({ kind: 'account', accountId }),
  requireAccess: mocks.requireAccess,
  listEvidenceSubmissions: mocks.listEvidenceSubmissions,
  loadVersionScanEvidence: mocks.loadVersionScanEvidence,
}));
vi.mock('../../../../lib/server-error', () => ({ reportServerError: mocks.reportServerError }));

const { COPIES_STATUSES, loadEvidenceCopies } = await import('./evidence-copies-data');

const row = (id: string, over: Record<string, unknown> = {}) =>
  ({
    id,
    kind: 'DOCUMENT',
    status: 'RECEIVED',
    applicantId: 'ap1',
    missionId: 'm1',
    ...over,
  }) as never;

const submission = (id: string, versionId: string, safetyStatus: string | null = 'CLEAN') => ({
  id,
  documentVersionId: versionId,
  safetyStatus,
});

const DB = { tag: 'db' } as never;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireAccess.mockImplementation(async (_db, _principal, action: string) => ({
    ok: true,
    value: { proof: action },
  }));
  mocks.listEvidenceSubmissions.mockImplementation(
    async (_proof, input: { requestId: string }) => ({
      ok: true,
      value: {
        available: true,
        submissions: [submission(`s-${input.requestId}`, `v-${input.requestId}`)],
        legacy: [],
      },
    }),
  );
  mocks.loadVersionScanEvidence.mockResolvedValue(new Map());
});

describe('reading the copies sent for the requests on screen', () => {
  it('reads only document requests that have something sent, decided or sent back', async () => {
    const result = await loadEvidenceCopies(DB, 'acct', 'org', [
      row('r1'),
      row('r2', { status: 'OPEN' }),
      row('r3', { kind: 'FIELD' }),
      row('r4', { status: 'NEEDS_REPLACEMENT' }),
      row('r5', { status: 'ACCEPTED' }),
      row('r6', { status: 'CANCELLED' }),
    ]);
    expect([...result.keys()].sort()).toEqual(['r1', 'r4', 'r5']);
    expect([...COPIES_STATUSES].sort()).toEqual([
      'ACCEPTED',
      'NEEDS_REPLACEMENT',
      'RECEIVED',
      'UNDER_REVIEW',
    ]);
  });

  it('reads each request through the organization own MANAGE proof for its case', async () => {
    await loadEvidenceCopies(DB, 'acct', 'org', [row('r1')]);
    expect(mocks.requireAccess).toHaveBeenCalledWith(
      DB,
      { kind: 'account', accountId: 'acct' },
      'MANAGE',
      { missionId: 'm1' },
      expect.objectContaining({ actingFor: { organizationId: 'org' } }),
    );
    expect(mocks.listEvidenceSubmissions).toHaveBeenCalledWith(
      { proof: 'MANAGE' },
      { requestId: 'r1' },
    );
  });

  it('uses one proof per case or traveller, not one per request, and reads a request once', async () => {
    await loadEvidenceCopies(DB, 'acct', 'org', [
      row('r1'),
      row('r1'),
      row('r2'),
      row('r3', { missionId: null }),
    ]);
    const manage = mocks.requireAccess.mock.calls.filter((call) => call[2] === 'MANAGE');
    expect(manage.map((call) => call[3])).toEqual([{ missionId: 'm1' }, { applicantId: 'ap1' }]);
    expect(mocks.listEvidenceSubmissions).toHaveBeenCalledTimes(3);
  });

  it('reads how each file was checked with its own VIEW_METADATA proof, never the MANAGE one', async () => {
    mocks.loadVersionScanEvidence.mockResolvedValue(
      new Map([['v-r1', { kind: 'VIRUS_SCANNED', scannedAt: 'x' }]]),
    );
    const result = await loadEvidenceCopies(DB, 'acct', 'org', [row('r1')]);
    expect(mocks.requireAccess.mock.calls.map((call) => call[2])).toEqual([
      'MANAGE',
      'VIEW_METADATA',
    ]);
    expect(mocks.loadVersionScanEvidence).toHaveBeenCalledWith({ proof: 'VIEW_METADATA' }, [
      { id: 'v-r1', safetyStatus: 'CLEAN' },
    ]);
    expect(result.get('r1')?.scan.get('v-r1')).toEqual({ kind: 'VIRUS_SCANNED', scannedAt: 'x' });
  });

  it('reads a file as format checked at most, never scanned, when the view proof is refused', async () => {
    mocks.requireAccess.mockImplementation(async (_db, _principal, action: string) =>
      action === 'MANAGE' ? { ok: true, value: { proof: 'MANAGE' } } : { ok: false, error: {} },
    );
    const result = await loadEvidenceCopies(DB, 'acct', 'org', [row('r1')]);
    expect(mocks.loadVersionScanEvidence).not.toHaveBeenCalled();
    expect(result.get('r1')?.scan.get('v-r1')?.kind).toBe('FORMAT_CHECKED');
  });
});

describe('what is left out, so the card says it could not be shown', () => {
  it('leaves out a case the organization can no longer manage, and reads none of its files', async () => {
    mocks.requireAccess.mockResolvedValue({ ok: false, error: { code: 'forbidden' } });
    const result = await loadEvidenceCopies(DB, 'acct', 'org', [row('r1')]);
    expect(result.size).toBe(0);
    expect(mocks.listEvidenceSubmissions).not.toHaveBeenCalled();
  });

  it('leaves out one request whose list is refused and keeps the others', async () => {
    mocks.listEvidenceSubmissions.mockImplementation(
      async (_proof, input: { requestId: string }) =>
        input.requestId === 'r1'
          ? { ok: false, error: { code: 'not_found' } }
          : { ok: true, value: { available: true, submissions: [], legacy: [] } },
    );
    const result = await loadEvidenceCopies(DB, 'acct', 'org', [row('r1'), row('r2')]);
    expect([...result.keys()]).toEqual(['r2']);
  });

  it('survives a failed read of one case: it is reported without ids and the page still renders', async () => {
    mocks.requireAccess.mockImplementation(async (_db, _principal, action: string, ref) => {
      if ('missionId' in ref && action === 'MANAGE') throw new Error('database down');
      return { ok: true, value: { proof: action } };
    });
    const result = await loadEvidenceCopies(DB, 'acct', 'org', [
      row('r1'),
      row('r2', { missionId: null }),
    ]);
    expect([...result.keys()]).toEqual(['r2']);
    expect(mocks.reportServerError).toHaveBeenCalledWith('evidenceCopiesRead', expect.any(Error), {
      step: 'read failed',
    });
  });
});
