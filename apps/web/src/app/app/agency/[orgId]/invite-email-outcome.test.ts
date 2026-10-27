import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClientInvitation: vi.fn(),
  addMemberByEmail: vi.fn(),
  sendEmailNow: vi.fn(),
  triggerNotificationWorker: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createClientInvitation: mocks.createClientInvitation,
  addMemberByEmail: mocks.addMemberByEmail,
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/server', () => ({ after: (fn: () => unknown) => fn() }));
vi.mock('../../../../lib/capabilities', () => ({
  getPlatformCapabilities: () => ({ agencyCollaboration: 'available' }),
  capabilityUnavailableMessage: () => 'unavailable',
}));
vi.mock('../../../../lib/base-url', () => ({ resolveBaseUrl: () => 'http://localhost' }));
vi.mock('../../../../lib/jobs', () => ({
  triggerNotificationWorker: mocks.triggerNotificationWorker,
}));
vi.mock('../../../../lib/send-now', () => ({ sendEmailNow: mocks.sendEmailNow }));
vi.mock('../../../../lib/providers', () => ({
  createKeyManagementPort: () => ({}),
  createMalwareScanner: () => undefined,
}));
vi.mock('../../../../lib/storage', () => ({ createStorage: () => undefined }));
vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: { db: object; accountId: string }) => unknown) =>
    fn({ db: {}, accountId: 'admin-test' }),
}));

const { inviteClientAction, addMemberAction } = await import('./actions');

const initial = { ok: true, message: '' };
function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}
const client = form({
  organizationId: 'org-1',
  caseOwnerAccountId: 'owner-1',
  displayName: 'Synthetic Traveller',
  contactDestination: 'traveller@example.com',
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.triggerNotificationWorker.mockResolvedValue({ sent: 0, retrying: 0, failed: 0 });
  mocks.createClientInvitation.mockResolvedValue({
    ok: true,
    value: { invitation: { id: 'inv-1' }, rawToken: 'tok', emailQueued: true },
  });
});

describe('what the invite screens say about the email', () => {
  it('sends the client email for this invitation while the agency waits, and says it went', async () => {
    mocks.sendEmailNow.mockResolvedValue('sent');
    const result = await inviteClientAction(initial, client);
    expect(mocks.sendEmailNow).toHaveBeenCalledWith('inv-1');
    expect(result.message).toMatch(/^Invitation emailed\./);
    expect(result.message).not.toContain('queued');
    expect(result.invitationUrl).toBe('http://localhost/invitation?kind=client&token=tok');
  });

  it('says plainly when the email has not gone out yet', async () => {
    mocks.sendEmailNow.mockResolvedValue('pending');
    const result = await inviteClientAction(initial, client);
    expect(result.message).toMatch(/^Invitation ready\. The email has not gone out yet/);
  });

  it('never claims an email when none could be queued', async () => {
    mocks.createClientInvitation.mockResolvedValue({
      ok: true,
      value: { invitation: { id: 'inv-1' }, rawToken: 'tok', emailQueued: false },
    });
    const result = await inviteClientAction(initial, client);
    expect(mocks.sendEmailNow).not.toHaveBeenCalled();
    expect(result.message).toContain('Email is not set up here');
  });

  it('sends a team invitation email at once too', async () => {
    mocks.addMemberByEmail.mockResolvedValue({
      ok: true,
      value: { kind: 'invited', invitation: { id: 'team-inv-1' }, rawToken: 'tt' },
    });
    mocks.sendEmailNow.mockResolvedValue('sent');
    const result = await addMemberAction(
      initial,
      form({ organizationId: 'org-1', memberEmail: 'member@example.com', role: 'REVIEWER' }),
    );
    expect(mocks.sendEmailNow).toHaveBeenCalledWith('team-inv-1');
    expect(result.message).toMatch(/^Invitation emailed\./);
    expect(result.invitationUrl).toBe('http://localhost/invitation?kind=team&token=tt');
  });
});
