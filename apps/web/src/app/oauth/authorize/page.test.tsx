import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer, stub, stubProps, textOf } from '../../../lib/next-mocks.test-support';

/** The consent screen's agency choice (S22): an agency in the address is re-checked, never trusted. */
const mocks = vi.hoisted(() => ({
  listApplicants: vi.fn(),
  listMembershipsForAccount: vi.fn(),
  getOrganizationAiSetting: vi.fn(),
  check: vi.fn(),
}));
vi.mock('@visastack/services', async (original) => ({
  ...(await original<typeof import('@visastack/services')>()),
  listApplicants: mocks.listApplicants,
  listMembershipsForAccount: mocks.listMembershipsForAccount,
  getOrganizationAiSetting: mocks.getOrganizationAiSetting,
}));
vi.mock('../../../lib/ai-connector', () => ({ aiConnectorEnabled: () => true }));
vi.mock('../../../lib/oauth-authorize', () => ({
  checkAuthorizeRequest: mocks.check,
  singleParam: (value: unknown) => (typeof value === 'string' ? value : undefined),
}));
vi.mock('../../../lib/public-db', () => ({
  withPublicDb: (fn: (db: unknown) => unknown) => fn({}),
}));
vi.mock('../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) => fn({ db: {}, accountId: 'acct' }),
}));
vi.mock('../../../lib/ai-file-picks-retry', () => ({
  AI_FILE_PICKS_CONSENT: 'consent',
  consentRequestKey: () => 'key',
  decodeAiFilePicks: () => null,
  rememberedAiFilePicks: async () => null,
}));
vi.mock('./consent-form', () => ({ ConsentForm: stub('ConsentForm') }));
vi.mock('./agency-consent-form', () => ({ AgencyConsentForm: stub('AgencyConsentForm') }));
const { default: Page } = await import('./page');

const RUN = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

function membership(id: string, role: string, active = true) {
  return { organization: { id, name: `Agency ${id.slice(0, 4)}`, status: 'ACTIVE' }, role, active };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.check.mockResolvedValue({
    kind: 'ok',
    request: {
      client: {
        clientId: 'https://claude.ai/meta',
        clientName: 'Claude',
        host: 'claude.ai',
        loopback: false,
      },
      redirectUri: 'https://claude.ai/api/mcp/auth_callback',
      codeChallenge: 'c'.repeat(43),
      resource: 'https://vs.example.test/mcp',
      state: 'abc',
    },
  });
  mocks.listApplicants.mockResolvedValue([]);
  mocks.listMembershipsForAccount.mockResolvedValue([
    membership(RUN, 'OWNER'),
    membership(OTHER, 'CASE_MANAGER'),
  ]);
  mocks.getOrganizationAiSetting.mockResolvedValue({
    ok: true,
    value: { available: true, enabled: true, canChange: true, feature: { available: true } },
  });
});

const render = (search: Record<string, string>) =>
  renderServer(Page({ searchParams: Promise.resolve(search) }));

describe('the agency choice on the consent screen (S22)', () => {
  it('lists only agencies the person runs with AI connections on, and opens the agency form for one', async () => {
    const listed = await render({});
    expect(listed).toContain(`agency=${RUN}`);
    expect(listed).not.toContain(`agency=${OTHER}`);
    const opened = await render({ agency: RUN });
    expect(stubProps(opened, 'AgencyConsentForm')).toHaveLength(1);
  });

  it('ignores a crafted address naming an agency the person does not run', async () => {
    const crafted = await render({ agency: OTHER });
    expect(stubProps(crafted, 'AgencyConsentForm')).toEqual([]);
    expect(textOf(crafted)).not.toContain('Agency: ');
    const unknown = await render({ agency: '33333333-3333-4333-8333-333333333333' });
    expect(stubProps(unknown, 'AgencyConsentForm')).toEqual([]);
  });

  it('offers no agency while its setting or Agency AI Tools is off', async () => {
    mocks.getOrganizationAiSetting.mockResolvedValue({
      ok: true,
      value: { available: true, enabled: true, canChange: true, feature: { available: false } },
    });
    const html = await render({ agency: RUN });
    expect(stubProps(html, 'AgencyConsentForm')).toEqual([]);
    expect(html).not.toContain(`agency=${RUN}`);
  });
});
