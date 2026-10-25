import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer, stub, stubProps, textOf } from '../../../../../lib/next-mocks.test-support';
import type { RecordItem } from '../record-hub';

const mocks = vi.hoisted(() => ({
  getApplicant: vi.fn(),
  listApplicantProfile: vi.fn(),
  getProfileSectionState: vi.fn(),
  getWalletView: vi.fn(),
  listDocumentsDetailed: vi.fn(),
}));
vi.mock('@visastack/services', async (original) => ({
  ...(await original<typeof import('@visastack/services')>()),
  ...mocks,
}));
vi.mock('../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) => fn({ db: {}, accountId: 'owner' }),
}));
vi.mock('../record-browser', () => ({ RecordBrowser: stub('RecordBrowser') }));
const { default: Page } = await import('./page');

const person = '10000000-0000-4000-8000-000000000001';
const render = () => renderServer(Page({ params: Promise.resolve({ id: person }) }));

function walletRow(id: string, document: Record<string, unknown> = {}, status = 'CURRENT') {
  return {
    document: {
      id,
      approvedName: null,
      originalName: `Synthetic ${id}`,
      docType: 'BANK_STATEMENT',
      subject: null,
      expiresAt: new Date('2030-01-01T00:00:00Z'),
      supersededByDocumentId: null,
      ...document,
    },
    status,
    usedInMissions: [],
    accessibleTo: [],
  };
}
function summary(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    safetyStatus: 'CLEAN',
    processingStatus: 'AWAITING_REVIEW',
    latestVersionNumber: 1,
    updatedAt: '2026-10-01T00:00:00.000Z',
    classification: null,
    pendingNameVersion: null,
    ...overrides,
  };
}
async function items() {
  const html = await render();
  const [props] = stubProps<{ items: RecordItem[] }>(html, 'RecordBrowser');
  return { html, items: props?.items ?? [] };
}
const byTitle = (list: readonly RecordItem[], title: string) =>
  list.find((item) => item.title === title);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getApplicant.mockResolvedValue({
    id: person,
    ownerAccountId: 'owner',
    displayName: 'Synthetic Self',
  });
  mocks.listApplicantProfile.mockResolvedValue([]);
  mocks.getProfileSectionState.mockResolvedValue({
    activated: new Set(),
    notApplicable: new Set(),
    noneDeclared: new Set(),
  });
  mocks.getWalletView.mockResolvedValue({ ok: true, value: [] });
  mocks.listDocumentsDetailed.mockResolvedValue({ ok: true, value: [] });
});

describe('the Record hub page', () => {
  it('is not found for anyone but the owner, before any record is read', async () => {
    mocks.getApplicant.mockResolvedValue({ id: person, ownerAccountId: 'another' });
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND');
    for (const read of [
      mocks.listApplicantProfile,
      mocks.getProfileSectionState,
      mocks.getWalletView,
      mocks.listDocumentsDetailed,
    ]) {
      expect(read).not.toHaveBeenCalled();
    }
  });

  it('says plainly when documents could not be loaded, and lists only profile details', async () => {
    for (const failing of [mocks.getWalletView, mocks.listDocumentsDetailed]) {
      mocks.getWalletView.mockResolvedValue({ ok: true, value: [walletRow('a')] });
      mocks.listDocumentsDetailed.mockResolvedValue({ ok: true, value: [summary('a')] });
      failing.mockResolvedValue({ ok: false, error: { code: 'internal', message: 'synthetic' } });
      const { html, items: list } = await items();
      expect(textOf(html)).toContain('Your documents could not be loaded just now');
      expect(html).toContain('role="alert"');
      expect(textOf(html)).not.toContain('You have not added a document yet');
      expect(list.length).toBeGreaterThan(0);
      expect(list.every((item) => item.kind === 'details')).toBe(true);
    }
  });

  it('uses one name for the page and its section link', async () => {
    const { html } = await items();
    expect(textOf(html)).toContain('All Records');
    expect(textOf(html)).not.toContain('Personal Record');
  });

  it('decides on the server which documents are ready, with the rule Cases and downloads use', async () => {
    mocks.getWalletView.mockResolvedValue({
      ok: true,
      value: [
        walletRow('finished'),
        walletRow('unscanned'),
        walletRow('held'),
        walletRow('reading'),
        walletRow('passport', { docType: 'PASSPORT', expiresAt: null }, 'UNKNOWN'),
        walletRow('kind'),
        walletRow('renamed'),
      ],
    });
    mocks.listDocumentsDetailed.mockResolvedValue({
      ok: true,
      value: [
        summary('finished'),
        summary('unscanned', { safetyStatus: 'PENDING' }),
        summary('held', { safetyStatus: 'QUARANTINED', processingStatus: 'QUARANTINED' }),
        summary('reading', { processingStatus: 'EXTRACTING' }),
        summary('passport'),
        summary('kind', {
          classification: {
            classifiedType: 'BANK_STATEMENT',
            confidence: 0.4,
            reviewRequired: true,
          },
        }),
        summary('renamed', { pendingNameVersion: { id: 'v', proposedName: 'Synthetic New' } }),
      ],
    });
    const { items: list } = await items();
    const finished = byTitle(list, 'Synthetic finished');
    expect(finished?.usable).toBe(true);
    expect(finished?.actions.map((action) => action.label)).toEqual([
      'View',
      'Update or Replace',
      'Use in Case',
      'Share',
    ]);
    expect(finished?.actions.at(-1)?.href).toBe(
      `/app/applicant/${person}/sharing?document=finished#new-sharing-request`,
    );
    const expected: Record<string, string> = {
      'Synthetic unscanned': 'Still Being Checked',
      'Synthetic held': 'Cannot Be Used',
      'Synthetic reading': 'Still Being Checked',
      'Synthetic passport': 'Needs Your Check',
      'Synthetic kind': 'Needs Your Check',
      'Synthetic renamed': 'Needs Your Check',
    };
    for (const [title, label] of Object.entries(expected)) {
      const item = byTitle(list, title);
      expect(item?.status.label, title).toBe(label);
      expect(item?.usable, title).toBe(false);
      expect(
        item?.actions.map((action) => action.label),
        title,
      ).not.toContain('Share');
    }
  });
});
