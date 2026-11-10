import { DEFAULT_CLIENT_GRANT_ACTIONS, GRANT_DEFAULT_DURATION_DAYS } from '@visastack/services';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer, stub, textOf } from '../../../../lib/next-mocks.test-support';

const state = vi.hoisted(() => ({
  preview: { ok: true } as unknown,
  consents: { CORE_PROCESSING: true, SHARING: true } as Record<string, boolean>,
}));

vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  previewClientInvitation: async () => state.preview,
  getConsents: async () => state.consents,
  listApplicants: async () => [],
  getOrganizationBrandingForDisplay: async () => undefined,
  aiAssistAvailable: async () => false,
}));
vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1' }),
}));
vi.mock('./accept-form', () => ({
  AcceptClientInvitationForm: stub('AcceptClientInvitationForm'),
}));
vi.mock('./consent-gate', () => ({ ConsentGate: stub('ConsentGate') }));

const { default: Page } = await import('./page');

const preview = {
  ok: true,
  value: {
    organizationId: 'org-1',
    organizationName: 'Atlas Visa Agency',
    requestedRoute: 'UK visitor visa',
    grantActions: DEFAULT_CLIENT_GRANT_ACTIONS,
  },
};
const render = () =>
  renderServer(Page({ searchParams: Promise.resolve({ token: 't'.repeat(43) }) }));

beforeEach(() => {
  state.preview = preview;
  state.consents = { CORE_PROCESSING: true, SHARING: true };
});

describe('how long an agency keeps access, said where the traveller accepts (friction F2)', () => {
  it('says the real length and where to pause or end it, once, before the accept button', async () => {
    const html = await render();
    const text = textOf(html);
    // The number is the services' own default, the one the grant is really given on accepting.
    expect(text).toContain(
      `Access lasts ${GRANT_DEFAULT_DURATION_DAYS} days from the day you accept. You can pause or end it any time in Sharing & Requests.`,
    );
    expect(text.match(/Access lasts/g)).toHaveLength(1);
    expect(html.indexOf('Access lasts')).toBeLessThan(html.indexOf('AcceptClientInvitationForm'));
  });

  it('also shows it while the traveller still has consents to turn on', async () => {
    state.consents = { CORE_PROCESSING: false, SHARING: false };
    expect(textOf(await render())).toContain('Access lasts');
  });

  it('shows no duration when the invitation itself cannot be shown', async () => {
    state.preview = { ok: false, error: { code: 'not_found', message: 'x' } };
    expect(textOf(await render())).not.toContain('Access lasts');
  });
});
