import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer, stub, stubProps, textOf } from '../../../../../lib/next-mocks.test-support';
const mocks = vi.hoisted(() => ({
  getApplicant: vi.fn(),
  listAccessForApplicantDetailed: vi.fn(),
  listDocumentsDetailed: vi.fn(),
  listAuditEventsForApplicant: vi.fn(),
  previewScopeExpansion: vi.fn(),
}));
vi.mock('@visastack/services', async (original) => ({
  ...(await original<typeof import('@visastack/services')>()),
  ...mocks,
}));
vi.mock('../../../../../lib/locale', () => ({ getLocale: async () => 'en' }));
vi.mock('../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) => fn({ db: {}, accountId: 'owner' }),
}));
vi.mock('./grant-form', () => ({ GrantForm: stub('GrantForm') }));
vi.mock('./grant-op-buttons', () => ({ GrantOpButtons: stub('GrantOpButtons') }));
vi.mock('./scope-expansion-form', () => ({ ScopeExpansionForm: stub('ScopeExpansionForm') }));
const { default: Page } = await import('./page');
const render = () => renderServer(Page({ params: Promise.resolve({ id: 'owned' }) }));
function grant(status: string, id = status) {
  return {
    id,
    status,
    recipient: { label: 'Synthetic recipient', kind: 'account' },
    actions: ['VIEW_METADATA'],
    missionId: null,
    categories: null,
    documentIds: ['passport'],
    purpose: 'Visa review',
    expiryAt: null,
    acceptedAt: null,
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getApplicant.mockResolvedValue({ id: 'owned', ownerAccountId: 'owner' });
  mocks.listAccessForApplicantDetailed.mockResolvedValue({ ok: true, value: [] });
  mocks.listDocumentsDetailed.mockResolvedValue({
    ok: true,
    value: [{ id: 'passport', originalName: 'Passport summary', approvedName: null }],
  });
  mocks.listAuditEventsForApplicant.mockResolvedValue([]);
});
describe('actual authorized sharing composition', () => {
  it('refuses foreign ownership before any sharing/document/audit read', async () => {
    mocks.getApplicant.mockResolvedValue({ ownerAccountId: 'another' });
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.listAccessForApplicantDetailed).not.toHaveBeenCalled();
    expect(mocks.listDocumentsDetailed).not.toHaveBeenCalled();
    expect(mocks.listAuditEventsForApplicant).not.toHaveBeenCalled();
  });
  it('keeps pending acceptance separate from active access and preserves narrow document names', async () => {
    mocks.listAccessForApplicantDetailed.mockResolvedValue({
      ok: true,
      value: [grant('ACTIVE'), grant('PENDING_ACCEPTANCE')],
    });
    const html = await render();
    expect(textOf(html)).toContain('1 active grants');
    expect(textOf(html)).toContain('Passport summary');
    const ops = stubProps<{ ops: { op: string }[] }>(html, 'GrantOpButtons');
    expect(ops[0]?.ops.map((op) => op.op)).toEqual(['pause', 'revoke']);
    expect(ops[1]?.ops.map((op) => op.op)).toEqual(['revoke']);
    expect(html).toContain('id="new-sharing-request"');
  });
  it('does not report failed access reads as an empty private account', async () => {
    mocks.listAccessForApplicantDetailed.mockResolvedValue({ ok: false });
    const text = textOf(await render());
    expect(text).toContain('This does not mean nobody has access');
    expect(text).not.toContain('Nobody has access yet');
  });
  it('withholds a composer when document scope cannot be loaded', async () => {
    mocks.listDocumentsDetailed.mockResolvedValue({ ok: false });
    const html = await render();
    expect(stubProps(html, 'GrantForm')).toHaveLength(0);
    expect(textOf(html)).toContain('Document records are unavailable');
  });
});
