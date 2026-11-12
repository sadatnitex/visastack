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
  loadOrgAccess: vi.fn(),
  loadMembers: vi.fn(),
  loadPendingClientInvitationPage: vi.fn(),
  loadEvidenceRequestPage: vi.fn(),
  loadApplicants: vi.fn(),
  loadVisibleCaseList: vi.fn(),
  loadEvidenceCopies: vi.fn(),
}));
vi.mock('../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'admin@example.com' }),
}));
vi.mock('../console-data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../console-data')>();
  return {
    ...mocks,
    AGENCY_LIST_SIZES: actual.AGENCY_LIST_SIZES,
    REQUEST_VIEWS: actual.REQUEST_VIEWS,
  };
});
vi.mock('../evidence-copies-data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../evidence-copies-data')>();
  return { COPIES_STATUSES: actual.COPIES_STATUSES, loadEvidenceCopies: mocks.loadEvidenceCopies };
});
vi.mock('../evidence-copy-actions', () => ({ downloadEvidenceCopyAction: async () => undefined }));
vi.mock('../client-invitation-form', async () => {
  const { stub } = await import('../../../../../lib/next-mocks.test-support');
  return { ClientInvitationForm: stub('ClientInvitationForm') };
});
vi.mock('../client-invitation-revoke-button', async () => {
  const { stub } = await import('../../../../../lib/next-mocks.test-support');
  return { ClientInvitationRevokeButton: stub('ClientInvitationRevokeButton') };
});
vi.mock('../evidence-request-actions', async () => {
  const { stub } = await import('../../../../../lib/next-mocks.test-support');
  return { EvidenceRequestActions: stub('EvidenceRequestActions') };
});
vi.mock('../request-evidence-form', async () => {
  const { stub } = await import('../../../../../lib/next-mocks.test-support');
  return { RequestEvidenceForm: stub('RequestEvidenceForm') };
});

import { appAgencyCatalog } from '../../../../../i18n/app-agency';

const { default: Page } = await import('./page');

const BENGALI = /[ঀ-৿]/;
const bn = appAgencyCatalog.bn as Record<string, string>;
const k = (key: string) => `appAgency.appAgencyOrgidClientsPage.${key}`;
const page = (items: unknown[]) => ({ items, nextCursor: null, total: items.length });
const counts = { all: 1, open: 1, review: 0, replacement: 0, closed: 0 };

async function show(locale: 'en' | 'bn', search: Record<string, string> = {}) {
  current.holder = null;
  current.locale = locale;
  return textOf(
    await renderServer(
      Page({ params: Promise.resolve({ orgId: 'o1' }), searchParams: Promise.resolve(search) }),
    ),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  navigationState.pathname = '/app/agency/o1/clients';
  mocks.loadOrgAccess.mockResolvedValue({ org: { id: 'o1' }, admin: true, member: true });
  mocks.loadMembers.mockResolvedValue([]);
  mocks.loadPendingClientInvitationPage.mockResolvedValue(page([]));
  mocks.loadEvidenceRequestPage.mockResolvedValue({
    ...page([]),
    viewCounts: { ...counts, all: 0, open: 0 },
  });
  mocks.loadEvidenceCopies.mockResolvedValue(new Map());
  mocks.loadApplicants.mockResolvedValue([]);
  mocks.loadVisibleCaseList.mockResolvedValue([]);
});
afterEach(() => {
  current.locale = 'en';
});

describe('the agency Clients page under Bengali', () => {
  it('shows Bengali headings and empty states, and keeps the access and invitation sentences English (nothing yet)', async () => {
    const text = await show('bn');
    expect(text).toContain(bn[k('clients')]);
    expect(text).toContain(bn[k('addPeopleAndRequests')]);
    expect(text).toContain(bn[k('inviteAClient')]);
    expect(text).toContain(bn[k('noClientsInvitedYet')]);
    expect(text).toContain(bn[k('noEvidenceRequestsYet')]);
    expect(text).toContain(bn[k('thisIsWhereYouAskA')]);
    // Held: what a traveller decides about access, and the invitation sentences.
    expect(text).toContain('Invite a traveller as a new client. They alone choose');
    expect(text).toContain('Ask a traveller for a specific detail or document. They decide');
    expect(text).toContain('This is where you invite the people you help.');
    expect(text).not.toMatch(/appAgency\./);
  });

  it('shows the request list in Bengali, with invitation lines and the due date left English (rows state)', async () => {
    mocks.loadPendingClientInvitationPage.mockResolvedValue(
      page([
        {
          id: 'ci1',
          displayName: 'Karim Hossain',
          contactDestination: 'karim@example.com',
          expiresAt: '2099-11-01T00:00:00Z',
        },
      ]),
    );
    mocks.loadEvidenceRequestPage.mockResolvedValue({
      ...page([
        {
          id: 'r1',
          kind: 'DOCUMENT',
          docType: 'PASSPORT',
          fieldKey: null,
          status: 'RECEIVED',
          applicantName: 'Rahim Uddin',
          dueDate: '2026-10-20T00:00:00Z',
          referenceCode: 'R-7K2Q9M',
        },
      ]),
      viewCounts: counts,
    });
    const text = await show('bn');
    expect(text).toContain(bn[k('evidenceRequests')]);
    expect(text).toContain(bn[k('requestReference')]);
    expect(text).toContain('Karim Hossain');
    // Held: the invitation expiry line and the due date inside a sentence.
    expect(text).toContain('Invited · expires');
    expect(text).toContain('· due Oct 20, 2026');
    expect(text).not.toContain(bn[k('noClientsInvitedYet')]);
    expect(text).not.toMatch(/appAgency\./);
  });

  it('names the request a link led to in Bengali when it is not on the page yet (linked state)', async () => {
    const linked = '11111111-1111-4111-8111-111111111111';
    const row = {
      id: linked,
      kind: 'DOCUMENT',
      docType: 'PASSPORT',
      fieldKey: null,
      status: 'RECEIVED',
      applicantName: 'Rahim Uddin',
      dueDate: null,
      referenceCode: 'R-7K2Q9M',
    };
    mocks.loadEvidenceRequestPage.mockImplementation(
      async (
        _db: unknown,
        _a: unknown,
        _o: unknown,
        _access: unknown,
        options: { only?: string },
      ) =>
        options.only ? { ...page([row]), viewCounts: counts } : { ...page([]), viewCounts: counts },
    );
    const text = await show('bn', { request: linked });
    expect(text).not.toMatch(/appAgency\./);
    const html = await renderServer(
      Page({
        params: Promise.resolve({ orgId: 'o1' }),
        searchParams: Promise.resolve({ request: linked }),
      }),
    );
    expect(html).toContain(`aria-label="${bn[k('theRequestYouFollowedALink')]}"`);
  });

  it('keeps the explanation in English for a member who is not an administrator', async () => {
    mocks.loadOrgAccess.mockResolvedValue({ org: { id: 'o1' }, admin: false, member: true });
    const text = await show('bn');
    expect(text).toContain('Inviting clients and requesting evidence are limited');
    expect(text).not.toContain(bn[k('inviteAClient')]);
  });

  it('stays all English for English readers', async () => {
    const text = await show('en');
    expect(text).toContain('Invite a Client');
    expect(text).toContain('No Clients Invited Yet');
    expect(text).not.toMatch(BENGALI);
  });
});
