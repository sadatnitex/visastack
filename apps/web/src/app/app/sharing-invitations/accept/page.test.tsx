import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer, stub, textOf } from '../../../../lib/next-mocks.test-support';

const state = vi.hoisted(() => ({
  invite: {} as Record<string, unknown>,
  sender: null as { email: string } | null,
  declineReady: true,
  refused: null as { code: string; message: string } | null,
}));

vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  previewSharingInvitation: async () =>
    state.refused ? { ok: false, error: state.refused } : { ok: true, value: state.invite },
  sharingInvitationSender: async () => state.sender,
  getConsents: async () => ({ CORE_PROCESSING: true, SHARING: true }),
  invitationDeclineAvailable: async () => state.declineReady,
}));
vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1' }),
}));
vi.mock('./accept-form', () => ({
  AcceptSharingInvitationForm: stub('AcceptSharingInvitationForm'),
}));
vi.mock('../../client-invitations/accept/consent-gate', () => ({
  ConsentGate: stub('ConsentGate'),
}));

const { default: Page } = await import('./page');

beforeEach(() => {
  state.sender = { email: 'karim@example.test' };
  state.declineReady = true;
  state.refused = null;
  vi.stubEnv('PERSONAL_SHARING_INVITATIONS_ENABLED', 'true');
  state.invite = {
    purpose: 'Review my documents',
    actions: ['VIEW_METADATA', 'PREVIEW', 'COMMENT'],
    categories: ['professional', 'business'],
    documentIds: null,
    documentScopeSnapshot: null,
    grantExpiryAt: new Date('2030-12-12T10:00:00Z'),
    expiresAt: new Date('2030-12-01T10:00:00Z'),
  };
});

const render = () =>
  renderServer(Page({ searchParams: Promise.resolve({ token: 't'.repeat(43) }) }));

describe('what the person who is offered access reads (friction F4 and F9)', () => {
  it('names each part of the profile the way the traveller saw it, never a raw code (F4)', async () => {
    const text = textOf(await render());
    expect(text).toContain('Professional / employment, Business / investment');
    expect(text).not.toMatch(/\bprofessional\b(?! \/)/);
    expect(text).not.toContain('Professional,');
  });

  it('writes what they can do as sentences (F9)', async () => {
    const html = await render();
    const text = textOf(html);
    // In the voice of the person being offered access: these are the sharer's documents, not theirs.
    expect(text).toContain('You will be able to see the details of their documents.');
    expect(text).toContain('You will be able to open and read their documents.');
    expect(text).toContain('You will be able to leave comments.');
    expect(text).not.toMatch(/\byour documents\b/i);
    // The old comma list of labels is gone.
    expect(text).not.toContain('See Document Details, Preview Documents');
  });

  it('still shows the end of the access and the end of the invitation, and the accept form', async () => {
    const html = await render();
    const text = textOf(html);
    expect(text).toContain('Access Ends');
    expect(text).toContain('12 Dec 2030');
    expect(text).toContain('Invitation Expires');
    expect(html).toContain('AcceptSharingInvitationForm');
  });

  it('shows who is sharing, by email, so the invited person can recognise the sender (F3)', async () => {
    const text = textOf(await render());
    expect(text).toContain('Shared By');
    expect(text).toContain('karim@example.test');
  });

  it('shows nothing extra when the sender cannot be found, never a guess (F3)', async () => {
    state.sender = null;
    const text = textOf(await render());
    expect(text).not.toContain('Shared By');
    expect(text).toContain('Review Shared Access');
  });
});

describe('saying no on the accept screen (DECL1)', () => {
  it('offers Decline next to accepting, as a form post with a confirm step', async () => {
    const html = await render();
    expect(html).toContain('data-testid="decline-invitation"');
    const text = textOf(html);
    expect(text).toContain('Decline');
    expect(text).toContain(
      'Say no to this invitation? Nothing is shared, and this link stops working.',
    );
    expect(text).toContain('Decline Invitation');
    expect(html.indexOf('AcceptSharingInvitationForm')).toBeLessThan(
      html.indexOf('data-testid="decline-invitation"'),
    );
  });

  it('offers no Decline before the update that stores it is in place', async () => {
    state.declineReady = false;
    const html = await render();
    expect(html).not.toContain('data-testid="decline-invitation"');
    expect(html).toContain('AcceptSharingInvitationForm');
  });

  it('offers no Decline when the invitation cannot be used', async () => {
    state.refused = { code: 'not_found', message: 'Invitation unavailable.' };
    const html = await render();
    expect(html).not.toContain('data-testid="decline-invitation"');
  });
});
