import { beforeEach, describe, expect, it, vi } from 'vitest';
import { navigationState, renderServer } from '../../../../../lib/next-mocks.test-support';
import { missingBengali } from '../../agency-bn.test-support';

// The language switch is off in the product, so the locale is set here directly.
const current = vi.hoisted(() => ({ locale: 'en' as 'en' | 'bn', holder: null as unknown }));
vi.mock('../../../../../lib/locale', () => ({ getLocale: async () => current.locale }));
// Outside the server runtime React's cache remembers nothing; stand in for one request per render.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: (build: () => unknown) => () => {
    current.holder ??= build();
    return current.holder;
  },
}));
vi.mock('server-only', () => ({}));

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
const detail = (status: string) => ({
  ok: true,
  value: {
    packId: PACK,
    name: 'Japan Tourist Starter List',
    jurisdiction: 'JP',
    purpose: 'tourism',
    version: { id: 'dv1', version: 2, status },
    hasPublished: true,
    items: [item],
  },
});

async function drawList(locale: 'en' | 'bn') {
  current.holder = null;
  current.locale = locale;
  return renderServer(await ListPage(listProps));
}
async function drawEdit(locale: 'en' | 'bn') {
  current.holder = null;
  current.locale = locale;
  return renderServer(await EditPage(editProps));
}

beforeEach(() => {
  vi.clearAllMocks();
  navigationState.pathname = `/app/agency/${ORG}/checklists`;
  mocks.principal.mockResolvedValue({ ok: true, value: { organizationId: ORG } });
  mocks.own.mockResolvedValue({ ok: true, value: [] });
  mocks.shared.mockResolvedValue({ ok: true, value: [] });
});

describe('the checklist pages under Bengali', () => {
  it('draws the list page heading, description and country filter in Bengali', async () => {
    const html = await drawList('bn');
    expect(html).not.toMatch(/appAgency\./);
    expect(
      missingBengali(html, [
        'appAgencyOrgidChecklistsPage.checklists',
        'appAgencyOrgidChecklistsPage.makeACountryListYourOwn',
        'appAgencyOrgidChecklistsPage.country',
      ]),
    ).toEqual([]);
  });

  it('draws a draft being changed in Bengali', async () => {
    mocks.detail.mockResolvedValue(detail('DRAFT'));
    const html = await drawEdit('bn');
    expect(html).not.toMatch(/appAgency\./);
    expect(
      missingBengali(html, [
        'appAgencyOrgidChecklistsEditPage.youAreChangingADraftCases',
        'appAgencyOrgidChecklistsEditPage.draftVersionVersion',
      ]),
    ).toEqual([]);
  });

  it('draws a change that is ready to publish in Bengali', async () => {
    mocks.detail.mockResolvedValue(detail('APPROVED'));
    const html = await drawEdit('bn');
    expect(html).not.toMatch(/appAgency\./);
    expect(
      missingBengali(html, [
        'appAgencyOrgidChecklistsEditPage.aChangeIsReadyButNot',
        'appAgencyOrgidChecklistsEditPage.readyToPublishVersionVersion',
      ]),
    ).toEqual([]);
  });

  it('draws a published list in Bengali', async () => {
    mocks.detail.mockResolvedValue(detail('PUBLISHED'));
    const html = await drawEdit('bn');
    expect(html).not.toMatch(/appAgency\./);
    expect(
      missingBengali(html, [
        'appAgencyOrgidChecklistsEditPage.casesOnYourAgencyOfferThis',
        'appAgencyOrgidChecklistsEditPage.publishedVersionVersion',
      ]),
    ).toEqual([]);
  });

  it('draws more shared lists than fit, starters and our own copies, in Bengali', async () => {
    const shared = Array.from({ length: 61 }, (_, n) => ({
      packVersionId: `pv${n}`,
      packName: `Shared List ${n}`,
      jurisdiction: 'JP',
      purpose: 'tourism',
      starter: n === 0,
      version: 1,
      ownCopyPackId: n === 1 ? PACK : null,
    }));
    mocks.shared.mockResolvedValue({ ok: true, value: shared });
    const html = await drawList('bn');
    expect(
      missingBengali(html, [
        'appAgencyOrgidChecklistsPage.starterListNotOfficial',
        'appAgencyOrgidChecklistsPage.openOurCopy',
        'appAgencyOrgidChecklistsPage.showingTheFirstLengthSearchBy',
      ]),
    ).toEqual([]);
    expect(html).toContain('৬০');
    expect(html).not.toMatch(/appAgency\./);
  });

  it('draws a list with no items in Bengali', async () => {
    const empty = detail('DRAFT');
    mocks.detail.mockResolvedValue({ ...empty, value: { ...empty.value, items: [] } });
    const html = await drawEdit('bn');
    expect(
      missingBengali(html, ['appAgencyOrgidChecklistsEditPage.thisListHasNoItemsYet']),
    ).toEqual([]);
  });

  it('keeps the English edit page as it was', async () => {
    mocks.detail.mockResolvedValue(detail('DRAFT'));
    expect(await drawEdit('en')).toContain('Draft, Version 2');
  });
});
