import { beforeEach, describe, expect, it, vi } from 'vitest';
import { navigationState, renderServer, textOf } from '../../../../../lib/next-mocks.test-support';

/** Agency checklist pages. Synthetic values only; the services are stand-ins here. */

const mocks = vi.hoisted(() => ({
  principal: vi.fn(),
  own: vi.fn(),
  shared: vi.fn(),
  detail: vi.fn(),
}));
vi.mock('../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'owner@example.test' }),
}));
vi.mock('@visastack/services', async (load) => ({
  ...(await load<typeof import('@visastack/services')>()),
  agencyChecklistPrincipal: mocks.principal,
  listAgencyOwnLists: mocks.own,
  listAgencyStartingLists: mocks.shared,
  getAgencyListDetail: mocks.detail,
}));
vi.mock('./checklist-forms', async () => {
  const { stub } = await import('../../../../../lib/next-mocks.test-support');
  return {
    CopyListButton: stub('CopyListButton'),
    StartChangesButton: stub('StartChangesButton'),
    ItemEditor: stub('ItemEditor'),
    AddItemForm: stub('AddItemForm'),
    PublishButton: stub('PublishButton'),
    DiscardButton: stub('DiscardButton'),
  };
});

const { default: ListPage } = await import('./page');
const { default: EditPage } = await import('./edit/page');

const ORG = '20000000-0000-4000-8000-000000000001';
const PACK = '30000000-0000-4000-8000-000000000001';
const listProps = { params: Promise.resolve({ orgId: ORG }), searchParams: Promise.resolve({}) };
const editProps = {
  params: Promise.resolve({ orgId: ORG }),
  searchParams: Promise.resolve({ pack: PACK }),
};

const item = {
  id: 'i1',
  kind: 'DOCUMENT',
  docType: 'PASSPORT',
  necessity: 'MANDATORY',
  optional: false,
  notes: 'Valid passport, nine months.',
  interpretation: 'All applicants',
};

beforeEach(() => {
  vi.clearAllMocks();
  navigationState.pathname = `/app/agency/${ORG}/checklists`;
  mocks.principal.mockResolvedValue({ ok: true, value: { organizationId: ORG } });
  mocks.own.mockResolvedValue({ ok: true, value: [] });
  mocks.shared.mockResolvedValue({ ok: true, value: [] });
});

describe('agency checklist pages', () => {
  it('are not found when the person is not an owner or admin of this agency', async () => {
    mocks.principal.mockResolvedValue({ ok: false, error: { code: 'forbidden' } });
    await expect(ListPage(listProps)).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(EditPage(editProps)).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('an edit page for a list this agency does not own is not found', async () => {
    mocks.detail.mockResolvedValue({ ok: false, error: { code: 'not_found' } });
    await expect(EditPage(editProps)).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('the list page offers a shared list to copy, marked not official, and links to an existing copy', async () => {
    mocks.own.mockResolvedValue({
      ok: true,
      value: [
        {
          packId: PACK,
          name: 'Japan Tourist Starter List',
          jurisdiction: 'JP',
          purpose: 'tourism',
          publishedVersion: 1,
          openDraftVersion: 2,
        },
      ],
    });
    mocks.shared.mockResolvedValue({
      ok: true,
      value: [
        {
          packVersionId: 'pv1',
          packName: 'France Tourist Starter List',
          jurisdiction: 'FR',
          purpose: 'tourism',
          starter: true,
          version: 1,
          ownCopyPackId: null,
        },
        {
          packVersionId: 'pv2',
          packName: 'Japan Tourist Starter List',
          jurisdiction: 'JP',
          purpose: 'tourism',
          starter: true,
          version: 1,
          ownCopyPackId: PACK,
        },
      ],
    });
    const html = await renderServer(await ListPage(listProps));
    const text = textOf(html);
    expect(text).toContain('Draft Open');
    expect(text).toContain('Starter List, Not Official');
    expect(html).toContain('CopyListButton');
    expect(html).toContain(`/app/agency/${ORG}/checklists/edit?pack=${PACK}`);
    expect(text).toContain('Open Our Copy');
  });

  it('the edit page shows the draft with an editor per item, the add form and the finish buttons', async () => {
    mocks.detail.mockResolvedValue({
      ok: true,
      value: {
        packId: PACK,
        name: 'Japan Tourist Starter List',
        jurisdiction: 'JP',
        purpose: 'tourism',
        version: { id: 'dv1', version: 2, status: 'DRAFT' },
        hasPublished: true,
        items: [item],
      },
    });
    const html = await renderServer(await EditPage(editProps));
    expect(textOf(html)).toContain('Draft, Version 2');
    for (const name of ['ItemEditor', 'AddItemForm', 'PublishButton', 'DiscardButton']) {
      expect(html).toContain(name);
    }
    expect(html).not.toContain('StartChangesButton');
  });

  it('the edit page shows a published list read-only with a way to open a draft', async () => {
    mocks.detail.mockResolvedValue({
      ok: true,
      value: {
        packId: PACK,
        name: 'Japan Tourist Starter List',
        jurisdiction: 'JP',
        purpose: 'tourism',
        version: { id: 'pv1', version: 1, status: 'PUBLISHED' },
        hasPublished: true,
        items: [item],
      },
    });
    const html = await renderServer(await EditPage(editProps));
    const text = textOf(html);
    expect(text).toContain('Valid passport, nine months.');
    expect(text).toContain('For: All applicants');
    expect(html).toContain('StartChangesButton');
    expect(html).not.toContain('ItemEditor');
  });
});
