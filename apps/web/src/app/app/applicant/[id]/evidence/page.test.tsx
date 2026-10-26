import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer, stub, textOf } from '../../../../../lib/next-mocks.test-support';

const mocks = vi.hoisted(() => ({
  getApplicant: vi.fn(),
  listEvidenceRequestsForApplicant: vi.fn(),
  referenceCodesFor: vi.fn(),
}));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  getApplicant: mocks.getApplicant,
  listEvidenceRequestsForApplicant: mocks.listEvidenceRequestsForApplicant,
  referenceCodesFor: mocks.referenceCodesFor,
  listApplicantProfile: async () => [],
  listDocumentsDetailed: async () => ({ ok: true, value: [] }),
  listEvidenceRequestDecisions: async () => ({ ok: true, value: [] }),
}));
vi.mock('../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) => fn({ db: {}, accountId: 'owner' }),
}));
vi.mock('./submit-response-form', () => ({ SubmitResponseForm: stub('SubmitResponseForm') }));

const { default: EvidencePage } = await import('./page');
const render = () => renderServer(EvidencePage({ params: Promise.resolve({ id: 'a1' }) }));

const request = {
  id: 'r1',
  kind: 'DOCUMENT',
  docType: 'BANK_STATEMENT',
  fieldKey: null,
  status: 'OPEN',
  message: null,
  dueDate: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getApplicant.mockResolvedValue({ id: 'a1', ownerAccountId: 'owner', displayName: 'R' });
  mocks.listEvidenceRequestsForApplicant.mockResolvedValue({ ok: true, value: [request] });
});

describe('request reference codes on the evidence page (ADR 0018)', () => {
  it('shows each request code, read in one call for the listed requests', async () => {
    mocks.referenceCodesFor.mockResolvedValue(new Map([['r1', 'R-7K2Q9M']]));
    const html = await render();
    expect(mocks.referenceCodesFor).toHaveBeenCalledWith(expect.anything(), 'R', ['r1']);
    expect(textOf(html)).toContain('Request Reference');
    expect(html).toContain('R-7K2Q9M');
  });

  it('shows no code before migration 0091 has run', async () => {
    mocks.referenceCodesFor.mockResolvedValue(new Map());
    expect(textOf(await render())).not.toContain('Request Reference');
  });
});
