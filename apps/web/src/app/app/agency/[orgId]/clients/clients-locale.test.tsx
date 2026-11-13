import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatDateOnly, formatTimestampDate } from '../../../../../lib/format-date';
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
const LATIN_DIGIT = /[0-9]/;
const ENGLISH_MONTH = /Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/;
// Far, fixed dates: a midday moment so no viewer time zone can move the day, and a plain day.
const EXPIRES_AT = '2099-11-01T12:00:00Z';
const DUE_DATE = '2099-10-20T00:00:00Z';
const bn = appAgencyCatalog.bn as Record<string, string>;
const k = (key: string) => `appAgency.appAgencyOrgidClientsPage.${key}`;
const page = (items: unknown[]) => ({ items, nextCursor: null, total: items.length });
const counts = { all: 1, open: 1, review: 0, replacement: 0, closed: 0 };

async function showHtml(locale: 'en' | 'bn', search: Record<string, string> = {}) {
  current.holder = null;
  current.locale = locale;
  return renderServer(
    Page({ params: Promise.resolve({ orgId: 'o1' }), searchParams: Promise.resolve(search) }),
  );
}

async function show(locale: 'en' | 'bn', search: Record<string, string> = {}) {
  return textOf(await showHtml(locale, search));
}

/** The words of the one element a selector finds, exactly as a reader gets them. */
function sentence(html: string, selector: string): string {
  const found = new JSDOM(`<body>${html}</body>`).window.document.querySelectorAll(selector);
  expect(found.length).toBe(1);
  return found[0]?.textContent ?? '';
}

function withDatedRows() {
  mocks.loadPendingClientInvitationPage.mockResolvedValue(
    page([
      {
        id: 'ci1',
        displayName: 'Karim Hossain',
        contactDestination: 'karim@example.com',
        expiresAt: EXPIRES_AT,
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
        dueDate: DUE_DATE,
        referenceCode: 'R-7K2Q9M',
      },
    ]),
    viewCounts: counts,
  });
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
    // What a traveller decides about access, and the invitation sentences: Bengali since the
    // owner sign-off of 2026-11-12.
    expect(text).toContain(bn[k('inviteATravellerAsANew')]);
    expect(text).toContain(bn[k('askATravellerForASpecific')]);
    expect(text).toContain(bn[k('thisIsWhereYouInviteThe')]);
    expect(text).not.toContain('They alone choose');
    expect(text).not.toMatch(/appAgency\./);
  });

  it('shows the request list in Bengali, with the invitation line and the due date in Bengali too (rows state)', async () => {
    mocks.loadPendingClientInvitationPage.mockResolvedValue(
      page([
        {
          id: 'ci1',
          displayName: 'Karim Hossain',
          contactDestination: 'karim@example.com',
          expiresAt: '2099-11-01T12:00:00Z',
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
    // The invitation expiry line and the due date: Bengali words around a Bengali date.
    expect(text).toContain('আমন্ত্রিত · মেয়াদ শেষ ১ নভে, ২০৯৯');
    expect(text).toContain('· শেষ তারিখ ২০ অক্টো, ২০২৬');
    expect(text).not.toContain('Invited · expires');
    expect(text).not.toContain('· due Oct 20, 2026');
    expect(text).not.toContain(bn[k('noClientsInvitedYet')]);
    expect(text).not.toMatch(/appAgency\./);
  });

  it('names a request for a profile detail Field in Bengali', async () => {
    mocks.loadEvidenceRequestPage.mockResolvedValue({
      ...page([
        {
          id: 'r2',
          kind: 'FIELD',
          docType: null,
          fieldKey: 'passport_number',
          status: 'OPEN',
          applicantName: 'Rahim Uddin',
          dueDate: null,
          referenceCode: 'R-8K2Q9M',
        },
      ]),
      viewCounts: counts,
    });
    const text = await show('bn');
    expect(text).toContain(bn[k('field')]);
    expect(text).not.toMatch(/appAgency\./);
  });

  it('says in Bengali that an invitation saved without a valid email cannot be accepted', async () => {
    mocks.loadPendingClientInvitationPage.mockResolvedValue(
      page([
        {
          id: 'ci2',
          displayName: 'Old Invite',
          contactDestination: 'not-an-email',
          expiresAt: '2099-11-01T00:00:00Z',
        },
      ]),
    );
    const text = await show('bn');
    expect(text).toContain(bn[k('cannotBeAcceptedRevokeAndInvite')]);
    expect(bn[k('cannotBeAcceptedRevokeAndInvite')]).toContain('\u00b7');
    expect(text).not.toContain('&middot;');
    expect(text).not.toContain('Cannot be accepted');
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

  it('shows the explanation in Bengali for a member who is not an administrator', async () => {
    mocks.loadOrgAccess.mockResolvedValue({ org: { id: 'o1' }, admin: false, member: true });
    const text = await show('bn');
    expect(text).toContain(bn[k('invitingClientsAndRequestingEvidenceAre')]);
    expect(text).not.toContain('Inviting clients and requesting evidence are limited');
    // The Invite a Client button is absent (its Bengali name begins the sentence above, so match the whole word).
    expect(text).not.toMatch(new RegExp(`${bn[k('inviteAClient')]}(?!\\p{M}|\\p{L})`, 'u'));
  });

  it('writes the invitation expiry line in Bengali with a Bengali date', async () => {
    withDatedRows();
    const html = await showHtml('bn');
    const line = sentence(html, '.badge-warning');
    expect(line).toBe(
      (bn[k('invitedExpiresFormattimestampdate')] ?? '').replace(
        '{formatTimestampDate}',
        formatTimestampDate(EXPIRES_AT, 'bn'),
      ),
    );
    expect(line).toBe('আমন্ত্রিত · মেয়াদ শেষ ১ নভে, ২০৯৯');
    expect(line).toContain('২০৯৯');
    expect(line).not.toMatch(LATIN_DIGIT);
    expect(line).not.toMatch(ENGLISH_MONTH);
    expect(html).not.toMatch(/appAgency\./);
  });

  it('writes the due date of a request in Bengali with a Bengali date', async () => {
    withDatedRows();
    const html = await showHtml('bn');
    const line = sentence(html, '.request-row .muted.u-fs-085');
    expect(line).toBe(
      `Rahim Uddin${(bn[k('dueFormatdateonly')] ?? '').replace(
        '{formatDateOnly}',
        formatDateOnly(DUE_DATE, 'bn'),
      )}`,
    );
    expect(line).toBe('Rahim Uddin · শেষ তারিখ ২০ অক্টো, ২০৯৯');
    expect(line).toContain('২০৯৯');
    expect(line).not.toMatch(LATIN_DIGIT);
    expect(line).not.toMatch(ENGLISH_MONTH);
    expect(html).not.toMatch(/appAgency\./);
  });

  it('keeps the invitation expiry line and the due date exactly as they were in English', async () => {
    withDatedRows();
    const html = await showHtml('en');
    const invited = sentence(html, '.badge-warning');
    expect(invited).toBe('Invited · expires 1 Nov 2099');
    expect(invited).not.toMatch(BENGALI);
    const due = sentence(html, '.request-row .muted.u-fs-085');
    expect(due).toBe('Rahim Uddin · due Oct 20, 2099');
    expect(due).not.toMatch(BENGALI);
  });

  it('stays all English for English readers', async () => {
    const text = await show('en');
    expect(text).toContain('Invite a Client');
    expect(text).toContain('No Clients Invited Yet');
    expect(text).not.toMatch(BENGALI);
  });
});
