import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer, stub, textOf } from '../../../../lib/next-mocks.test-support';

const state = vi.hoisted(() => ({
  invite: {} as Record<string, unknown>,
  sender: null as { email: string } | null,
}));

vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  previewSharingInvitation: async () => ({ ok: true, value: state.invite }),
  getSharingInvitationSender: async () => state.sender,
  getConsents: async () => ({ CORE_PROCESSING: true, SHARING: true }),
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
    expect(text).toContain('They can see the details of your documents.');
    expect(text).toContain('They can open and read your documents.');
    expect(text).toContain('They can leave comments.');
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
