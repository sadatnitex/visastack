import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatTimestampDate } from '../../../../../lib/format-date';
import { navigationState, renderServer } from '../../../../../lib/next-mocks.test-support';

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
  loadPendingTeamInvitations: vi.fn(),
}));
vi.mock('../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'admin@example.com' }),
}));
vi.mock('../console-data', () => mocks);
vi.mock('../invitation-revoke-button', async () => {
  const { stub } = await import('../../../../../lib/next-mocks.test-support');
  return { InvitationRevokeButton: stub('InvitationRevokeButton') };
});
vi.mock('../member-form', async () => {
  const { stub } = await import('../../../../../lib/next-mocks.test-support');
  return { AddMemberForm: stub('AddMemberForm') };
});
vi.mock('./document-request-toggle', async () => {
  const { stub } = await import('../../../../../lib/next-mocks.test-support');
  return { DocumentRequestToggle: stub('DocumentRequestToggle') };
});
vi.mock('@visastack/services', () => ({ agencyCollectionRequestsEnabled: () => false }));
vi.mock('../member-toggle-button', async () => {
  const { stub } = await import('../../../../../lib/next-mocks.test-support');
  return { MemberToggleButton: stub('MemberToggleButton') };
});

import { appAgencyCatalog } from '../../../../../i18n/app-agency';

const { default: Page } = await import('./page');

const BENGALI = /[ঀ-৿]/;
const LATIN_DIGIT = /[0-9]/;
const ENGLISH_MONTH = /Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/;
const bn = appAgencyCatalog.bn as Record<string, string>;
const INVITED = 'appAgency.appAgencyOrgidClientsPage.invitedExpiresFormattimestampdate';
// A far, fixed moment at midday, so a viewer within about twelve hours of UTC keeps the day (the checks run on UTC machines).
const EXPIRES_AT = '2099-11-01T12:00:00Z';

async function showHtml(locale: 'en' | 'bn') {
  current.holder = null;
  current.locale = locale;
  return renderServer(Page({ params: Promise.resolve({ orgId: 'o1' }) }));
}

/** The words of the one pending-invitation badge, exactly as a reader gets them. */
function invitationLine(html: string): string {
  const found = new JSDOM(`<body>${html}</body>`).window.document.querySelectorAll(
    '.badge-warning',
  );
  expect(found.length).toBe(1);
  return found[0]?.textContent ?? '';
}

beforeEach(() => {
  vi.clearAllMocks();
  navigationState.pathname = '/app/agency/o1/team';
  mocks.loadOrgAccess.mockResolvedValue({ org: { id: 'o1' }, admin: true, member: true });
  mocks.loadMembers.mockResolvedValue([
    {
      membershipId: 'ms1',
      accountId: 'a1',
      email: 'owner@example.com',
      role: 'OWNER',
      active: true,
    },
  ]);
  mocks.loadPendingTeamInvitations.mockResolvedValue([
    { id: 'inv1', email: 'new@example.com', role: 'CASE_MANAGER', expiresAt: EXPIRES_AT },
  ]);
});
afterEach(() => {
  current.locale = 'en';
});

describe('the agency Team page under Bengali', () => {
  it('writes the pending invitation line in Bengali with a Bengali date', async () => {
    const html = await showHtml('bn');
    const line = invitationLine(html);
    expect(line).toBe(
      (bn[INVITED] ?? '').replace('{formatTimestampDate}', formatTimestampDate(EXPIRES_AT, 'bn')),
    );
    expect(line).toBe('আমন্ত্রিত · মেয়াদ শেষ ১ নভে, ২০৯৯');
    expect(line).toContain('২০৯৯');
    expect(line).not.toMatch(LATIN_DIGIT);
    expect(line).not.toMatch(ENGLISH_MONTH);
    expect(html).toContain('new@example.com');
    expect(html).not.toMatch(/appAgency\./);
  });

  it('keeps the pending invitation line exactly as it was in English', async () => {
    const html = await showHtml('en');
    const line = invitationLine(html);
    expect(line).toBe('Invited · expires 1 Nov 2099');
    expect(line).not.toMatch(BENGALI);
    expect(html).not.toMatch(/appAgency\./);
  });
});
