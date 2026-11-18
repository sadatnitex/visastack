import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer, stub, textOf } from '../../../../lib/next-mocks.test-support';

const state = vi.hoisted(() => ({
  preview: { ok: true } as unknown,
  declineReady: true,
}));

vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  previewContributorRequest: async () => state.preview,
  getRetentionPolicies: async () => [],
  invitationDeclineAvailable: async () => state.declineReady,
}));
vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'sponsor@example.test' }),
}));
vi.mock('./submit-evidence-form', () => ({ SubmitEvidenceForm: stub('SubmitEvidenceForm') }));

const { default: Page } = await import('./page');

const open = (emailMatches: boolean) => ({
  ok: true,
  value: {
    applicantName: 'Synthetic Traveller',
    missionTitle: 'UK Student Visa',
    docType: 'bank_statement',
    purpose: 'To support the financial sponsorship section.',
    message: null,
    expiresAt: new Date('2030-12-01T10:00:00Z'),
    recipientOrganizationNames: [],
    emailMatches,
  },
});
const render = () =>
  renderServer(Page({ searchParams: Promise.resolve({ token: 't'.repeat(43) }) }));

beforeEach(() => {
  state.preview = open(true);
  state.declineReady = true;
});

describe('saying no to a document request (DECL1)', () => {
  it('offers Decline after the upload form, with its confirm step', async () => {
    const html = await render();
    expect(html).toContain('data-testid="decline-invitation"');
    const text = textOf(html);
    expect(text).toContain(
      'Say no to this request? Nothing is uploaded, and this link stops working.',
    );
    expect(text).toContain('Decline Request');
    expect(html.indexOf('SubmitEvidenceForm')).toBeLessThan(
      html.indexOf('data-testid="decline-invitation"'),
    );
  });

  it('offers no Decline to someone signed in with another address', async () => {
    state.preview = open(false);
    expect(await render()).not.toContain('data-testid="decline-invitation"');
  });

  it('offers no Decline before the update is in place, or when the request cannot be used', async () => {
    state.declineReady = false;
    expect(await render()).not.toContain('data-testid="decline-invitation"');
    state.declineReady = true;
    state.preview = { ok: false, error: { code: 'not_found', message: 'request not found' } };
    expect(await render()).not.toContain('data-testid="decline-invitation"');
  });
});
