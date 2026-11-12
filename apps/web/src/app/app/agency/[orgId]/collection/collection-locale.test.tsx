import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { navigationState, renderServer, textOf } from '../../../../../lib/next-mocks.test-support';

vi.mock('server-only', () => ({}));
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

const mocks = vi.hoisted(() => ({
  principal: vi.fn(),
  list: vi.fn(),
  get: vi.fn(),
  choices: vi.fn(),
  summary: vi.fn(),
}));
vi.mock('../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'admin@example.test' }),
}));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  agencyCollectionPrincipal: mocks.principal,
  listCollectionRequests: mocks.list,
  getCollectionRequest: mocks.get,
  listCollectionPackChoices: mocks.choices,
  summariseCollectionAnswers: mocks.summary,
}));
vi.mock('./collection-forms', async () => {
  const { stub } = await import('../../../../../lib/next-mocks.test-support');
  return {
    NewRequestForm: stub('NewRequestForm'),
    AddItemForm: stub('AddItemForm'),
    ItemEditForm: stub('ItemEditForm'),
    PackChoiceForm: stub('PackChoiceForm'),
    IssueRequestForm: stub('IssueRequestForm'),
    NewLinkForm: stub('NewLinkForm'),
    EmailLinkForm: stub('EmailLinkForm'),
    EndRequestForm: stub('EndRequestForm'),
  };
});

import { appAgencyCatalog } from '../../../../../i18n/app-agency';

const { default: ListPage } = await import('./page');
const { default: DetailPage } = await import('./request/page');

const BENGALI = /[ঀ-৿]/;
const bn = appAgencyCatalog.bn as Record<string, string>;
const k = (key: string) => `appAgency.appAgencyOrgid${key}`;
const ORG = '20000000-0000-4000-8000-000000000001';
const REQ = '30000000-0000-4000-8000-000000000001';
const at = new Date('2026-11-02T00:00:00Z');
const NOT_EMAILED = {
  status: 'NOT_EMAILED',
  reason: null,
  retrying: false,
  sentAt: null,
  deliveredAt: null,
} as const;

function detail(overrides: Record<string, unknown> = {}) {
  return {
    id: REQ,
    status: 'DRAFT',
    storedStatus: 'DRAFT',
    destination: 'GB',
    purpose: 'Tourism',
    route: null,
    travelFrom: null,
    travelTo: null,
    dueAt: null,
    nationality: null,
    residence: null,
    applicationPlace: null,
    recipientNameHint: 'Synthetic Person',
    recipientEmailHint: null,
    createdAt: at,
    draftPack: { packVersionId: 'pv1', packName: 'Synthetic UK Visit', version: 1 },
    draftItems: [],
    revisions: [],
    links: [],
    ...overrides,
  };
}

async function list(locale: 'en' | 'bn') {
  current.holder = null;
  current.locale = locale;
  return textOf(await renderServer(ListPage({ params: Promise.resolve({ orgId: ORG }) })));
}
async function request(locale: 'en' | 'bn') {
  current.holder = null;
  current.locale = locale;
  return textOf(
    await renderServer(
      DetailPage({
        params: Promise.resolve({ orgId: ORG }),
        searchParams: Promise.resolve({ id: REQ }),
      }),
    ),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  navigationState.pathname = `/app/agency/${ORG}/collection`;
  mocks.principal.mockResolvedValue({ ok: true, value: { authority: 'ADMIN' } });
  mocks.choices.mockResolvedValue({ ok: true, value: [] });
  mocks.summary.mockResolvedValue(new Map());
});
afterEach(() => {
  current.locale = 'en';
});

describe('the Document Requests list under Bengali', () => {
  it('shows the empty state with its Bengali hint and keeps the title English (nothing yet)', async () => {
    mocks.list.mockResolvedValue({ ok: true, value: [] });
    const text = await list('bn');
    expect(text).toContain(bn[k('CollectionPage.startOneWithNewRequestYou')]);
    expect(text).toContain('No Document Requests Yet');
    expect(text).not.toMatch(/appAgency\./);
  });

  it('shows Bengali for the column words and the accepted count in Bengali digits (rows state)', async () => {
    const id = '30000000-0000-4000-8000-000000000001';
    mocks.list.mockResolvedValue({
      ok: true,
      value: [
        {
          id,
          status: 'SENT',
          destination: 'GB',
          purpose: null,
          route: null,
          recipientNameHint: null,
          dueAt: null,
          createdAt: at,
          updatedAt: at,
        },
      ],
    });
    mocks.summary.mockResolvedValue(
      new Map([[id, { answers: 5, waiting: 2, needsCorrection: 1, accepted: 2 }]]),
    );
    const text = await list('bn');
    expect(text).toContain(bn[k('CollectionCollectionForms.notSureYet')]);
    expect(text).toContain('২টি গ্রহণ করা হয়েছে');
    // Held: the review and correction counts stay English next to it.
    expect(text).toContain('2 Waiting for Review');
    expect(text).toContain('1 Needs Correction');
    expect(text).not.toMatch(/appAgency\./);
  });

  it('stays English for English readers', async () => {
    mocks.list.mockResolvedValue({ ok: true, value: [] });
    expect(await list('en')).not.toMatch(BENGALI);
  });
});

describe('a Document Request under Bengali', () => {
  it('shows Bengali labels and keeps the checklist and rule wording English (draft state)', async () => {
    mocks.get.mockResolvedValue({
      ok: true,
      value: detail({ travelFrom: '2026-12-03', travelTo: '2026-12-10' }),
    });
    const text = await request('bn');
    expect(text).toContain(bn[k('CollectionRequestPage.checklist')]);
    expect(text).toContain(bn[k('CollectionRequestPage.travelDates')]);
    expect(text).toContain(bn[k('CollectionPage.for')]);
    // Held: the dates sit inside an English phrase, so they stay English.
    expect(text).toContain('Dec 3, 2026');
    expect(text).toContain('Issuing freezes this checklist');
    expect(text).toContain('No items yet. Add what your agency needs below.');
    expect(text).not.toMatch(/appAgency\./);
  });

  it('shows the sent state: Bengali link words, held table and sign-in wording in English', async () => {
    mocks.get.mockResolvedValue({
      ok: true,
      value: detail({
        status: 'SENT',
        storedStatus: 'SENT',
        revisions: [
          {
            id: 'rev1',
            revisionNo: 1,
            issuedAt: at,
            packVersionId: 'pv1',
            packChecksum: 'a'.repeat(64),
            intact: false,
            items: [],
            brand: null,
          },
        ],
        links: [
          {
            id: 'l1',
            revisionNo: 1,
            state: 'OPEN',
            emailed: false,
            email: NOT_EMAILED,
            createdAt: at,
            expiresAt: new Date('2026-11-16T00:00:00Z'),
            lastOpenedAt: null,
          },
        ],
      }),
    });
    const text = await request('bn');
    expect(text).toContain(bn[k('CollectionRequestPage.copiedLink')]);
    expect(text).toContain(bn[k('CollectionRequestPage.sentBy')]);
    expect(text).toContain(bn[k('CollectionRequestPage.share')]);
    expect(text).toContain('This revision no longer matches what was issued');
    expect(text).toContain('one-time code sent to the email address you entered');
    expect(text).toContain('End This Request');
    expect(text).not.toMatch(/appAgency\./);
  });

  it('stays English for English readers', async () => {
    mocks.get.mockResolvedValue({ ok: true, value: detail() });
    expect(await request('en')).not.toMatch(BENGALI);
  });
});
