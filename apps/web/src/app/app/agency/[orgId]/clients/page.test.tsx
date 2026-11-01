import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  navigationState,
  renderServer,
  stubProps,
  textOf,
} from '../../../../../lib/next-mocks.test-support';

const mocks = vi.hoisted(() => ({
  loadOrgAccess: vi.fn(),
  loadMembers: vi.fn(),
  loadPendingClientInvitationPage: vi.fn(),
  loadEvidenceRequestPage: vi.fn(),
  loadApplicants: vi.fn(),
  loadVisibleCaseList: vi.fn(),
}));

vi.mock('../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'admin@example.com' }),
}));
vi.mock('../console-data', async (importOriginal) => ({
  ...mocks,
  REQUEST_VIEWS: (await importOriginal<typeof import('../console-data')>()).REQUEST_VIEWS,
}));
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

const { default: Page } = await import('./page');

const props = { params: Promise.resolve({ orgId: 'o1' }) };
const withQuery = (query: Record<string, string>) => ({
  params: Promise.resolve({ orgId: 'o1' }),
  searchParams: Promise.resolve(query),
});
/** The page of pending invitations the loader returns (WP-SB5). */
const invitationPage = (items: unknown[], more: { nextCursor?: string; total?: number } = {}) => ({
  items,
  nextCursor: more.nextCursor ?? null,
  total: more.total ?? items.length,
});
const counts = { all: 2, open: 1, review: 1, replacement: 0, closed: 0 };
/** The page of evidence requests the loader returns (WP-SB5). */
const requestPage = (
  items: unknown[],
  more: { nextCursor?: string; total?: number; viewCounts?: typeof counts } = {},
) => ({
  items,
  nextCursor: more.nextCursor ?? null,
  total: more.total ?? items.length,
  viewCounts:
    more.viewCounts ?? (items.length ? counts : { ...counts, all: 0, open: 0, review: 0 }),
});

beforeEach(() => {
  vi.clearAllMocks();
  navigationState.pathname = '/app/agency/o1/clients';
  mocks.loadOrgAccess.mockResolvedValue({ org: { id: 'o1' }, admin: true, member: true });
  mocks.loadMembers.mockResolvedValue([
    { accountId: 'a1', email: 'owner@example.com', active: true, role: 'OWNER' },
  ]);
  mocks.loadPendingClientInvitationPage.mockResolvedValue(
    invitationPage([
      {
        id: 'ci1',
        displayName: 'Karim Hossain',
        contactDestination: 'karim@example.com',
        expiresAt: '2099-11-01T00:00:00Z',
      },
    ]),
  );
  mocks.loadEvidenceRequestPage.mockResolvedValue(
    requestPage([
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
      {
        id: 'r2',
        kind: 'DOCUMENT',
        docType: 'BANK_STATEMENT',
        fieldKey: null,
        status: 'OPEN',
        applicantName: 'Nusrat Jahan',
        dueDate: null,
      },
    ]),
  );
  mocks.loadApplicants.mockResolvedValue([{ id: 'ap1', displayName: 'Rahim Uddin' }]);
  mocks.loadVisibleCaseList.mockResolvedValue([
    { missionId: 'm1', title: 'UK Visitor', applicantName: 'Rahim Uddin', extra: 'ignored' },
  ]);
});

describe('agency Clients', () => {
  it('shows a request code where the request has one, and nothing where it has none (ADR 0018)', async () => {
    const html = await renderServer(Page(props));
    const rows = html.split('id="request-').slice(1);
    expect(rows[0]).toContain('R-7K2Q9M');
    expect(rows[0]).toContain('Request Reference');
    expect(rows[1]).not.toContain('Request Reference');
  });
  it('shows pending client invitations with who they are for and a revoke control', async () => {
    const html = await renderServer(Page(props));
    const text = textOf(html);
    expect(text).toContain('Karim Hossain');
    expect(text).toContain('karim@example.com');
    expect(text).toContain('Invited');
    expect(stubProps(html, 'ClientInvitationRevokeButton')).toEqual([
      { organizationId: 'o1', invitationId: 'ci1' },
    ]);
  });

  it('marks an older invitation sent to a phone number as one nobody can accept', async () => {
    mocks.loadPendingClientInvitationPage.mockResolvedValue(
      invitationPage([
        {
          id: 'ci1',
          displayName: 'Karim Hossain',
          contactDestination: 'karim@example.com',
          expiresAt: '2099-11-01T00:00:00Z',
        },
        {
          id: 'ci2',
          displayName: 'Rina Akter',
          contactDestination: '+880 1711 000000',
          expiresAt: '2099-11-01T00:00:00Z',
        },
      ]),
    );
    const text = textOf(await renderServer(Page(props)));
    expect(text).toContain('Cannot be accepted');
    expect(text).toContain('revoke and invite again by email');
    // Only the phone row: the email invitation still reads as invited.
    expect(text.match(/Cannot be accepted/g)).toHaveLength(1);
    expect(text).toMatch(/Invited . expires/);
  });

  it('marks a malformed stored address as one nobody can accept, and an expired invitation as expired', async () => {
    mocks.loadPendingClientInvitationPage.mockResolvedValue(
      invitationPage([
        {
          id: 'ci3',
          displayName: 'Old Address',
          contactDestination: 'jane@example.com.',
          expiresAt: '2099-11-01T00:00:00Z',
        },
        {
          id: 'ci4',
          displayName: 'Past Date',
          contactDestination: 'past@example.com',
          expiresAt: '2020-01-01T00:00:00Z',
        },
      ]),
    );
    const text = textOf(await renderServer(Page(props)));
    expect(text.match(/Cannot be accepted/g)).toHaveLength(1);
    expect(text).toContain('Expired');
    expect(text).not.toMatch(/Invited . expires/);
  });

  it('gives the invitation form the team it can assign, active or not', async () => {
    const [form] = stubProps<{ organizationId: string; members: unknown }>(
      await renderServer(Page(props)),
      'ClientInvitationForm',
    );
    expect(form?.organizationId).toBe('o1');
    expect(form?.members).toEqual([{ accountId: 'a1', email: 'owner@example.com', active: true }]);
  });

  it('gives the evidence request form the applicants and only the case fields it needs', async () => {
    const [form] = stubProps<{ applicants: unknown; missions: unknown }>(
      await renderServer(Page(props)),
      'RequestEvidenceForm',
    );
    expect(form?.applicants).toEqual([{ id: 'ap1', displayName: 'Rahim Uddin' }]);
    expect(form?.missions).toEqual([
      { missionId: 'm1', title: 'UK Visitor', applicantName: 'Rahim Uddin' },
    ]);
  });

  it('shows each evidence request with its status, and decision controls only where a decision is due', async () => {
    const html = await renderServer(Page(props));
    const text = textOf(html);
    expect(text).toContain('Document: Passport');
    expect(text).toContain('Received');
    expect(text).not.toContain('Submitted');
    expect(text).not.toContain('PASSPORT');
    expect(text).toContain('Document: Bank Statement');
    expect(text).toContain('Open');
    expect(stubProps(html, 'EvidenceRequestActions')).toEqual([
      { organizationId: 'o1', requestId: 'r1', status: 'RECEIVED' },
    ]);
  });

  it('says so when no evidence has been requested', async () => {
    mocks.loadEvidenceRequestPage.mockResolvedValue(requestPage([]));
    expect(textOf(await renderServer(Page(props)))).toContain('No Evidence Requests Yet');
  });

  it('points to the Cases section, where the work on a case happens', async () => {
    expect(await renderServer(Page(props))).toContain('href="/app/agency/o1/cases"');
  });

  it('tells a member who is not an administrator, and reads none of it for them', async () => {
    mocks.loadOrgAccess.mockResolvedValue({ org: { id: 'o1' }, admin: false, member: true });
    const html = await renderServer(Page(props));
    expect(textOf(html)).toContain("limited to this organization's owners and admins");
    for (const loader of [
      mocks.loadMembers,
      mocks.loadPendingClientInvitationPage,
      mocks.loadEvidenceRequestPage,
      mocks.loadApplicants,
      mocks.loadVisibleCaseList,
    ]) {
      expect(loader).not.toHaveBeenCalled();
    }
    expect(stubProps(html, 'RequestEvidenceForm')).toHaveLength(0);
  });

  it('renders nothing for someone with no role', async () => {
    mocks.loadOrgAccess.mockResolvedValue({ org: { id: 'o1' }, admin: false, member: false });
    expect(await renderServer(Page(props))).toBe('');
    expect(mocks.loadEvidenceRequestPage).not.toHaveBeenCalled();
  });
});

describe('agency Clients: Do Next links (WP-V4)', () => {
  it('gives each request a place Do Next can link to', async () => {
    const html = await renderServer(Page(props));
    expect(html).toContain('id="request-r1"');
    expect(html).toContain('id="request-r2"');
  });
});

describe('agency Clients: no file-state lookups (WP-V4 review)', () => {
  it('loads requests without the triage file-state lookups it would not use', async () => {
    await renderServer(Page(props));
    expect(mocks.loadEvidenceRequestPage).toHaveBeenCalledTimes(1);
    const options = mocks.loadEvidenceRequestPage.mock.calls[0]?.[4] as
      | { withFileStates?: boolean }
      | undefined;
    expect(options?.withFileStates).not.toBe(true);
  });
});

describe('agency Clients: within the scroll budget (WP-SB5)', () => {
  const request = (i: number) => ({
    id: `r${i}`,
    kind: 'DOCUMENT',
    docType: 'PASSPORT',
    fieldKey: null,
    status: 'OPEN',
    applicantName: `Traveller ${i}`,
    dueDate: null,
  });
  const invitation = (i: number) => ({
    id: `ci${i}`,
    displayName: `Client ${i}`,
    contactDestination: `client-${i}@example.com`,
    expiresAt: '2099-11-01T00:00:00Z',
  });

  it('shows 15 pending invitations, the total and a Show More link to the next page', async () => {
    mocks.loadPendingClientInvitationPage.mockResolvedValue(
      invitationPage(
        Array.from({ length: 15 }, (_, i) => invitation(i)),
        {
          nextCursor: 'inv-next',
          total: 400,
        },
      ),
    );
    const html = await renderServer(Page(props));
    expect(stubProps(html, 'ClientInvitationRevokeButton')).toHaveLength(15);
    expect(textOf(html)).toContain('Showing 15 of 400 pending invitations.');
    expect(html).toContain(
      'href="/app/agency/o1/clients?invitesBefore=inv-next#client-invitation-list"',
    );
    expect(mocks.loadPendingClientInvitationPage).toHaveBeenCalledWith(
      {},
      'acct-1',
      'o1',
      expect.objectContaining({ admin: true }),
      { before: undefined },
    );
  });

  it('passes the page cursor and offers a way back to the newest invitations', async () => {
    const html = await renderServer(Page(withQuery({ invitesBefore: 'abc_DEF-1' })));
    expect(mocks.loadPendingClientInvitationPage.mock.calls[0]?.[4]).toEqual({
      before: 'abc_DEF-1',
    });
    expect(textOf(html)).toContain('Back to the Newest Invitations');
  });

  it('ignores a cursor that is not shaped like one', async () => {
    await renderServer(Page(withQuery({ invitesBefore: '<script>', requestsBefore: 'a b' })));
    expect(mocks.loadPendingClientInvitationPage.mock.calls[0]?.[4]).toEqual({ before: undefined });
    expect(mocks.loadEvidenceRequestPage.mock.calls[0]?.[4]).toEqual({
      view: undefined,
      before: undefined,
    });
  });

  it('shows 15 requests with a status filter, the count of each view and Show More', async () => {
    mocks.loadEvidenceRequestPage.mockResolvedValue(
      requestPage(
        Array.from({ length: 15 }, (_, i) => request(i)),
        {
          nextCursor: 'req-next',
          total: 300,
          viewCounts: { all: 320, open: 300, review: 12, replacement: 3, closed: 5 },
        },
      ),
    );
    const html = await renderServer(Page(withQuery({ status: 'open' })));
    expect(html.split('id="request-').length - 1).toBe(15);
    const text = textOf(html);
    expect(text).toContain('Showing 15 of 300 requests.');
    for (const label of [
      'All 320',
      'Open 300',
      'Waiting on You 12',
      'Needs Replacement 3',
      'Closed 5',
    ]) {
      expect(text).toContain(label);
    }
    expect(mocks.loadEvidenceRequestPage.mock.calls[0]?.[4]).toEqual({
      view: 'open',
      before: undefined,
    });
    expect(html).toContain(
      'href="/app/agency/o1/clients?status=open&amp;requestsBefore=req-next#agency-evidence-request-list"',
    );
    expect(html).toMatch(/aria-label="Evidence requests by status"/);
    expect(html).toMatch(
      /href="\/app\/agency\/o1\/clients\?status=open#agency-evidence-requests" class="quick-view quick-view-on" aria-current="true"/,
    );
  });

  it('treats an unknown status as All', async () => {
    await renderServer(Page(withQuery({ status: 'everything' })));
    expect(mocks.loadEvidenceRequestPage.mock.calls[0]?.[4]).toEqual({
      view: undefined,
      before: undefined,
    });
  });

  it('keeps both forms behind their own headings, open only while there is nothing yet', async () => {
    const html = await renderServer(Page(props));
    expect(html).toMatch(/<details class="collapsible-group" id="invite-client">/);
    expect(html).toMatch(/<details class="collapsible-group" id="ask-for-evidence">/);
    mocks.loadPendingClientInvitationPage.mockResolvedValue(invitationPage([]));
    mocks.loadEvidenceRequestPage.mockResolvedValue(requestPage([]));
    const empty = await renderServer(Page(props));
    expect(empty).toMatch(/<details class="collapsible-group" id="invite-client" open="">/);
    expect(empty).toMatch(/<details class="collapsible-group" id="ask-for-evidence" open="">/);
  });
});
