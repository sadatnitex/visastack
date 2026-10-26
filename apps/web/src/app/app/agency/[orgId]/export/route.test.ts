import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The agency JSON export carries each exported person's visible code (ADR 0018),
 * read in one call for exactly the people already in the export, and nothing
 * when a person has no code yet.
 */
const mocks = vi.hoisted(() => ({
  bulkExport: vi.fn(),
  referenceCodesFor: vi.fn(),
  tryEstablishStepUp: vi.fn(),
  db: { marker: 'db' },
}));
vi.mock('@visastack/services', () => ({
  bulkExport: mocks.bulkExport,
  referenceCodesFor: mocks.referenceCodesFor,
}));
vi.mock('../../../../../lib/capabilities', () => ({
  capabilityUnavailableMessage: () => 'Unavailable.',
  getPlatformCapabilities: () => ({ bulkExport: 'available' }),
}));
vi.mock('../../../../../lib/step-up', () => ({
  STEP_UP_NOT_CONFIGURED_MESSAGE: 'Confirmation unavailable.',
  tryEstablishStepUp: mocks.tryEstablishStepUp,
}));
vi.mock('../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: mocks.db, accountId: 'admin' }),
}));

const { GET } = await import('./route');

const rows = [
  { applicantId: 'ap1', displayName: 'Rahim Example', facts: {} },
  { applicantId: 'ap2', displayName: 'Karim Example', facts: {} },
];

async function exportJson() {
  const response = await GET(new Request('https://example.test/app/agency/o1/export'), {
    params: Promise.resolve({ orgId: 'o1' }),
  });
  expect(response.status).toBe(200);
  return (await response.json()) as { applicants: Record<string, unknown>[] };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tryEstablishStepUp.mockResolvedValue({ kind: 'satisfied' });
  mocks.bulkExport.mockResolvedValue({ ok: true, value: rows });
});

describe('agency export reference codes (ADR 0018)', () => {
  it('adds the person code to each exported person that has one, in one read', async () => {
    mocks.referenceCodesFor.mockResolvedValue(new Map([['ap2', 'P-7K2Q9M']]));
    const body = await exportJson();
    expect(mocks.referenceCodesFor).toHaveBeenCalledTimes(1);
    expect(mocks.referenceCodesFor).toHaveBeenCalledWith(mocks.db, 'P', ['ap1', 'ap2']);
    expect(body.applicants).toEqual([rows[0], { ...rows[1], referenceCode: 'P-7K2Q9M' }]);
  });

  it('exports exactly as before when no codes exist yet', async () => {
    mocks.referenceCodesFor.mockResolvedValue(new Map());
    const body = await exportJson();
    expect(body.applicants).toEqual(rows);
  });

  it('never reads codes when the export itself is refused', async () => {
    mocks.bulkExport.mockResolvedValue({
      ok: false,
      error: { code: 'forbidden', message: 'only an org OWNER/ADMIN can bulk export' },
    });
    const response = await GET(new Request('https://example.test/app/agency/o1/export'), {
      params: Promise.resolve({ orgId: 'o1' }),
    });
    expect(response.status).toBe(403);
    expect(mocks.referenceCodesFor).not.toHaveBeenCalled();
  });
});
