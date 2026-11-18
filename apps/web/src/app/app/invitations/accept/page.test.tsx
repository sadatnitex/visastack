import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer, stub, textOf } from '../../../../lib/next-mocks.test-support';

const state = vi.hoisted(() => ({
  preview: { ok: true } as unknown,
  declineReady: true,
}));

vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  previewOrganizationInvitation: async () => state.preview,
  invitationDeclineAvailable: async () => state.declineReady,
}));
vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'invited@example.test' }),
}));
vi.mock('./accept-form', () => ({ AcceptInvitationForm: stub('AcceptInvitationForm') }));

const { default: Page } = await import('./page');

const open = (emailMatches: boolean) => ({
  ok: true,
  value: {
    organizationName: 'Atlas Visa Agency',
    role: 'CASE_MANAGER',
    invitedEmail: 'invited@example.test',
    expiresAt: new Date('2030-12-01T10:00:00Z'),
    emailMatches,
  },
});
const render = () =>
  renderServer(Page({ searchParams: Promise.resolve({ token: 't'.repeat(43) }) }));

beforeEach(() => {
  state.preview = open(true);
  state.declineReady = true;
});

describe('saying no to joining an agency (DECL1)', () => {
  it('offers Decline after Accept and Join, with its confirm step', async () => {
    const html = await render();
    expect(html).toContain('data-testid="decline-invitation"');
    expect(textOf(html)).toContain(
      'Say no to joining? You will not become a member, and this link stops working.',
    );
    expect(html.indexOf('AcceptInvitationForm')).toBeLessThan(
      html.indexOf('data-testid="decline-invitation"'),
    );
  });

  it('offers no Decline to someone signed in with another address', async () => {
    state.preview = open(false);
    const html = await render();
    expect(html).not.toContain('data-testid="decline-invitation"');
    expect(html).not.toContain('AcceptInvitationForm');
  });

  it('offers no Decline before the update is in place, or when the invitation cannot be used', async () => {
    state.declineReady = false;
    expect(await render()).not.toContain('data-testid="decline-invitation"');
    state.declineReady = true;
    state.preview = { ok: false, error: { code: 'not_found', message: 'invitation not found' } };
    expect(await render()).not.toContain('data-testid="decline-invitation"');
  });
});
