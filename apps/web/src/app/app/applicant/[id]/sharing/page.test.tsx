import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer, stub, stubProps, textOf } from '../../../../../lib/next-mocks.test-support';
const mocks = vi.hoisted(() => ({
  getApplicant: vi.fn(),
  listAccessForApplicantDetailed: vi.fn(),
  listDocumentsDetailed: vi.fn(),
  listAuditEventsForApplicant: vi.fn(),
  listApplicantProfile: vi.fn(),
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
vi.mock('./actions', () => ({ revokeSharingInvitationAction: vi.fn() }));
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
  mocks.listApplicantProfile.mockResolvedValue([]);
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
  it('offers a new category only once it holds a saved detail, and never a category with nothing in it', async () => {
    const none = await render();
    expect(
      stubProps<{ extraCategories: unknown[] }>(none, 'GrantForm')[0]?.extraCategories,
    ).toEqual([]);
    mocks.listApplicantProfile.mockResolvedValue([
      { fieldKey: 'given_name', value: 'Rahim', status: 'DECLARED' },
      { fieldKey: 'other_item_study_title', value: 'Scholarship letter', status: 'DECLARED' },
      { fieldKey: 'other_item_settle_title', value: '', status: null },
    ]);
    const some = await render();
    expect(
      stubProps<{ extraCategories: { key: string; label: string }[] }>(some, 'GrantForm')[0]
        ?.extraCategories,
    ).toEqual([{ key: 'study', label: expect.any(String) }]);
  });
  it('counts the documents that have no kind, because choosing parts of the profile leaves them out', async () => {
    mocks.listDocumentsDetailed.mockResolvedValue({
      ok: true,
      value: [
        { id: 'passport', originalName: 'Passport', approvedName: null, docType: 'PASSPORT' },
        { id: 'loose', originalName: 'Scan', approvedName: null, docType: null },
        { id: 'other', originalName: 'Other', approvedName: null, docType: 'NOT_A_KIND' },
      ],
    });
    const [form] = stubProps<{ unsortedDocuments: number }>(await render(), 'GrantForm');
    expect(form?.unsortedDocuments).toBe(2);
  });
  it('withholds a composer when document scope cannot be loaded', async () => {
    mocks.listDocumentsDetailed.mockResolvedValue({ ok: false });
    const html = await render();
    expect(stubProps(html, 'GrantForm')).toHaveLength(0);
    expect(textOf(html)).toContain('Document records are unavailable');
  });
});

describe('grant cards describe each grant in rows (WP-X2)', () => {
  it('reads live access in the present tense and ended access in the past, never as live', async () => {
    mocks.listAccessForApplicantDetailed.mockResolvedValue({
      ok: true,
      value: [
        {
          ...grant('ACTIVE'),
          actions: ['VIEW_METADATA', 'PREVIEW'],
          expiryAt: new Date('2099-11-24'),
        },
        grant('PAUSED'),
        { ...grant('REVOKED'), documentIds: null, actions: ['VIEW_METADATA', 'PREVIEW'] },
      ],
    });
    const html = await render();
    const cards = html.split('class="row sharing-grant"').slice(1);
    expect(cards).toHaveLength(3);
    const [active, paused, revoked] = cards.map((card) => textOf(card));
    expect(active).toContain('They can');
    expect(active).toContain('Can open');
    expect(active).toContain('Passport summary');
    // A document-limited grant shows no profile details.
    expect(active).toContain('none of your profile details');
    expect(paused).toContain('They could');
    expect(paused).toContain('They cannot see these without Preview documents.');
    expect(revoked).toContain('They could');
    expect(revoked).toContain('Ended');
    expect(revoked).not.toMatch(/They can(?!not)/);
    expect(cards[2]).not.toContain('scope-row-warning');
    expect(revoked).toContain('when you revoked it');
  });

  it('a grant past its end date reads as ended even before its status catches up', async () => {
    mocks.listAccessForApplicantDetailed.mockResolvedValue({
      ok: true,
      value: [{ ...grant('ACTIVE'), expiryAt: new Date('2020-01-01') }],
    });
    const card = textOf((await render()).split('class="row sharing-grant"')[1] ?? '');
    expect(card).toContain('They could');
    expect(card).toContain('Ended');
    expect(card).not.toMatch(/They can(?!not)/);
  });
});

describe('Share from the Record (WP-V3 part 2)', () => {
  const renderWith = (document: string | string[]) =>
    renderServer(
      Page({
        params: Promise.resolve({ id: 'owned' }),
        searchParams: Promise.resolve({ document }),
      }),
    );
  it('starts the new request with the one document chosen on the Record', async () => {
    const [form] = stubProps<{ initialDocumentId?: string }>(
      await renderWith('passport'),
      'GrantForm',
    );
    expect(form?.initialDocumentId).toBe('passport');
  });
  it("ignores a document that is not this person's, or a repeated value", async () => {
    for (const value of ['someone-else', ['passport', 'passport']]) {
      const [form] = stubProps<{ initialDocumentId?: string }>(
        await renderWith(value),
        'GrantForm',
      );
      expect(form).toBeDefined();
      expect(form?.initialDocumentId).toBeUndefined();
    }
  });
  it('without a choice the form starts as before', async () => {
    const [form] = stubProps<{ initialDocumentId?: string }>(await render(), 'GrantForm');
    expect(form?.initialDocumentId).toBeUndefined();
  });
});
