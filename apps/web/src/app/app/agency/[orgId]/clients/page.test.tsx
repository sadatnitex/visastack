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
  loadPendingClientInvitations: vi.fn(),
  loadEvidenceRequests: vi.fn(),
  loadApplicants: vi.fn(),
  loadVisibleCaseList: vi.fn(),
}));

vi.mock('../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'admin@example.com' }),
}));
vi.mock('../console-data', () => mocks);
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

beforeEach(() => {
  vi.clearAllMocks();
  navigationState.pathname = '/app/agency/o1/clients';
  mocks.loadOrgAccess.mockResolvedValue({ org: { id: 'o1' }, admin: true, member: true });
  mocks.loadMembers.mockResolvedValue([
    { accountId: 'a1', email: 'owner@example.com', active: true, role: 'OWNER' },
  ]);
  mocks.loadPendingClientInvitations.mockResolvedValue([
    {
      id: 'ci1',
      displayName: 'Karim Hossain',
      contactDestination: 'karim@example.com',
      expiresAt: '2026-11-01T00:00:00Z',
    },
  ]);
  mocks.loadEvidenceRequests.mockResolvedValue([
    {
      id: 'r1',
      kind: 'DOCUMENT',
      docType: 'PASSPORT',
      fieldKey: null,
      status: 'RECEIVED',
      applicantName: 'Rahim Uddin',
      dueDate: '2026-10-20T00:00:00Z',
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
  ]);
  mocks.loadApplicants.mockResolvedValue([{ id: 'ap1', displayName: 'Rahim Uddin' }]);
  mocks.loadVisibleCaseList.mockResolvedValue([
    { missionId: 'm1', title: 'UK Visitor', applicantName: 'Rahim Uddin', extra: 'ignored' },
  ]);
});

describe('agency Clients', () => {
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
    mocks.loadPendingClientInvitations.mockResolvedValue([
      {
        id: 'ci1',
        displayName: 'Karim Hossain',
        contactDestination: 'karim@example.com',
        expiresAt: '2026-11-01T00:00:00Z',
      },
      {
        id: 'ci2',
        displayName: 'Rina Akter',
        contactDestination: '+880 1711 000000',
        expiresAt: '2026-11-01T00:00:00Z',
      },
    ]);
    const text = textOf(await renderServer(Page(props)));
    expect(text).toContain('Cannot be accepted');
    expect(text).toContain('revoke and invite again by email');
    // Only the phone row: the email invitation still reads as invited.
    expect(text.match(/Cannot be accepted/g)).toHaveLength(1);
    expect(text).toMatch(/Invited . expires/);
  });

  it('marks a malformed stored address as one nobody can accept, and an expired invitation as expired', async () => {
    mocks.loadPendingClientInvitations.mockResolvedValue([
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
    ]);
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
    expect(text).toContain('Document: PASSPORT');
    expect(text).toContain('Submitted');
    expect(text).toContain('Document: BANK_STATEMENT');
    expect(text).toContain('Open');
    expect(stubProps(html, 'EvidenceRequestActions')).toEqual([
      { organizationId: 'o1', requestId: 'r1', status: 'RECEIVED' },
    ]);
  });

  it('says so when no evidence has been requested', async () => {
    mocks.loadEvidenceRequests.mockResolvedValue([]);
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
      mocks.loadPendingClientInvitations,
      mocks.loadEvidenceRequests,
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
    expect(mocks.loadEvidenceRequests).not.toHaveBeenCalled();
  });
});

describe('agency Clients: Do Next links (WP-V4)', () => {
  it('gives each request a place Do Next can link to', async () => {
    const html = await renderServer(Page(props));
    expect(html).toContain('id="request-r1"');
    expect(html).toContain('id="request-r2"');
  });
});
