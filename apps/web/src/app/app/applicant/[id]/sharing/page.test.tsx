import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer, stub, stubProps, textOf } from '../../../../../lib/next-mocks.test-support';
const mocks = vi.hoisted(() => ({
  getApplicant: vi.fn(),
  listAccessForApplicantDetailed: vi.fn(),
  listDocumentsDetailed: vi.fn(),
  listAuditEventsForApplicant: vi.fn(),
  listApplicantProfile: vi.fn(),
  previewScopeExpansion: vi.fn(),
  listSharingInvitations: vi.fn(),
  listInvitationCaseExceptions: vi.fn(),
  requireAccess: vi.fn(),
  listAiConnections: vi.fn(),
  listMissions: vi.fn(),
  listAiDrafts: vi.fn(),
  getAiFeatureStates: vi.fn(),
  aiAssistAvailable: vi.fn(async () => false),
}));
type GrantFixture = { status: string; expiryAt: Date | null };
/**
 * The page asks for one page of grants (WP-SB3). Fixtures stay plain lists: this turns a list
 * into the page the service returns, first `limit` grants plus counts over all of them.
 */
async function grantPage(...args: unknown[]) {
  const listed = (await mocks.listAccessForApplicantDetailed(...args)) as
    | { ok: true; value: GrantFixture[] }
    | { ok: false };
  const options = args[3] as { limit?: number } | undefined;
  if (!listed.ok || !Array.isArray(listed.value) || !options) return listed;
  const holds = (grant: GrantFixture) =>
    (grant.status === 'ACTIVE' || grant.status === 'PAUSED') &&
    (grant.expiryAt === null || new Date(grant.expiryAt).getTime() > Date.now());
  return {
    ok: true,
    value: {
      items: listed.value.slice(0, options.limit ?? 100),
      counts: {
        total: listed.value.length,
        active: listed.value.filter((grant) => grant.status === 'ACTIVE').length,
        holdingAccess: listed.value.filter(holds).length,
      },
    },
  };
}
vi.mock('@visastack/services', async (original) => ({
  ...(await original<typeof import('@visastack/services')>()),
  ...mocks,
  listAccessForApplicantDetailed: grantPage,
}));
vi.mock('../../../../../lib/locale', () => ({ getLocale: async () => 'en' }));
vi.mock('../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) => fn({ db: {}, accountId: 'owner' }),
}));
vi.mock('../../../../../lib/ccd/depth.server', () => ({ readDepth: async () => 'auto' }));
vi.mock('./actions', () => ({ revokeSharingInvitationAction: vi.fn() }));
vi.mock('./grant-form', () => ({ GrantForm: stub('GrantForm') }));
vi.mock('./grant-op-buttons', () => ({ GrantOpButtons: stub('GrantOpButtons') }));
vi.mock('./scope-expansion-form', () => ({ ScopeExpansionForm: stub('ScopeExpansionForm') }));
vi.mock('./case-exceptions', () => ({ CaseExceptions: stub('CaseExceptions') }));
vi.mock('./ai-connections', () => ({ AiConnectionsSection: stub('AiConnectionsSection') }));
vi.mock('./grant-ai-choice', () => ({ GrantAiChoice: stub('GrantAiChoice') }));
const { default: Page } = await import('./page');
const render = () => renderServer(Page({ params: Promise.resolve({ id: 'owned' }) }));
function grant(status: string, id = status) {
  return {
    id,
    status,
    recipient: { label: 'Synthetic recipient', kind: 'account' },
    actions: ['VIEW_METADATA'],
    missionId: null,
    categories: null,
    documentIds: ['passport'],
    purpose: 'Visa review',
    expiryAt: null,
    acceptedAt: null,
    caseExceptions: [] as { missionId: string; missionTitle: string; since: Date }[],
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getApplicant.mockResolvedValue({ id: 'owned', ownerAccountId: 'owner' });
  mocks.listAccessForApplicantDetailed.mockResolvedValue({ ok: true, value: [] });
  mocks.listDocumentsDetailed.mockResolvedValue({
    ok: true,
    value: [{ id: 'passport', originalName: 'Passport summary', approvedName: null }],
  });
  mocks.listAuditEventsForApplicant.mockResolvedValue([]);
  mocks.listApplicantProfile.mockResolvedValue([]);
  mocks.requireAccess.mockResolvedValue({ ok: true, value: { proof: 'owner' } });
  mocks.listAiConnections.mockResolvedValue({
    ok: true,
    value: { available: true, active: [], recentlyEnded: [] },
  });
  mocks.listAiDrafts.mockResolvedValue({ available: true, drafts: [], more: 0 });
  mocks.getAiFeatureStates.mockImplementation(async (_db: unknown, features: string[]) =>
    Object.fromEntries(
      features.map((feature) => [
        feature,
        { feature, available: true, reason: null, dailyLimit: null },
      ]),
    ),
  );
});
describe('actual authorized sharing composition', () => {
  it('refuses foreign ownership before any sharing/document/audit read', async () => {
    mocks.getApplicant.mockResolvedValue({ ownerAccountId: 'another' });
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.listAccessForApplicantDetailed).not.toHaveBeenCalled();
    expect(mocks.listDocumentsDetailed).not.toHaveBeenCalled();
    expect(mocks.listAuditEventsForApplicant).not.toHaveBeenCalled();
    expect(mocks.listAiConnections).not.toHaveBeenCalled();
  });
  it('keeps pending acceptance separate from active access and preserves narrow document names', async () => {
    mocks.listAccessForApplicantDetailed.mockResolvedValue({
      ok: true,
      value: [grant('ACTIVE'), grant('PENDING_ACCEPTANCE')],
    });
    const html = await render();
    expect(textOf(html)).toContain('1 active grant. ');
    expect(textOf(html)).toContain('Passport summary');
    const ops = stubProps<{ ops: { op: string }[] }>(html, 'GrantOpButtons');
    expect(ops[0]?.ops.map((op) => op.op)).toEqual(['pause', 'revoke']);
    expect(ops[1]?.ops.map((op) => op.op)).toEqual(['revoke']);
    expect(html).toContain('id="new-sharing-request"');
  });
  it('does not report failed access reads as an empty private account', async () => {
    mocks.listAccessForApplicantDetailed.mockResolvedValue({ ok: false });
    const text = textOf(await render());
    expect(text).toContain('This does not mean nobody has access');
    expect(text).not.toContain('Nobody Has Access Yet');
  });
  it('offers a new category only once it holds a saved detail, and never a category with nothing in it', async () => {
    const none = await render();
    expect(
      stubProps<{ extraCategories: unknown[] }>(none, 'GrantForm')[0]?.extraCategories,
    ).toEqual([]);
    mocks.listApplicantProfile.mockResolvedValue([
      { fieldKey: 'given_name', value: 'Rahim', status: 'DECLARED' },
      { fieldKey: 'other_item_study_title', value: 'Scholarship letter', status: 'DECLARED' },
      { fieldKey: 'other_item_settle_title', value: '', status: null },
    ]);
    const some = await render();
    expect(
      stubProps<{ extraCategories: { key: string; label: string }[] }>(some, 'GrantForm')[0]
        ?.extraCategories,
    ).toEqual([{ key: 'study', label: expect.any(String) }]);
  });
  it('counts the documents that have no kind, because choosing parts of the profile leaves them out', async () => {
    mocks.listDocumentsDetailed.mockResolvedValue({
      ok: true,
      value: [
        { id: 'passport', originalName: 'Passport', approvedName: null, docType: 'PASSPORT' },
        { id: 'loose', originalName: 'Scan', approvedName: null, docType: null },
        { id: 'other', originalName: 'Other', approvedName: null, docType: 'NOT_A_KIND' },
      ],
    });
    const [form] = stubProps<{ unsortedDocuments: number }>(await render(), 'GrantForm');
    expect(form?.unsortedDocuments).toBe(2);
  });
  it('withholds a composer when document scope cannot be loaded', async () => {
    mocks.listDocumentsDetailed.mockResolvedValue({ ok: false });
    const html = await render();
    expect(stubProps(html, 'GrantForm')).toHaveLength(0);
    expect(textOf(html)).toContain('Document records are unavailable');
  });
});

describe('grant cards describe each grant in rows (WP-X2)', () => {
  it('reads live access in the present tense and ended access in the past, never as live', async () => {
    mocks.listAccessForApplicantDetailed.mockResolvedValue({
      ok: true,
      value: [
        {
          ...grant('ACTIVE'),
          actions: ['VIEW_METADATA', 'PREVIEW'],
          expiryAt: new Date('2099-11-24'),
        },
        grant('PAUSED'),
        { ...grant('REVOKED'), documentIds: null, actions: ['VIEW_METADATA', 'PREVIEW'] },
      ],
    });
    const html = await render();
    const cards = html.split('class="row sharing-grant"').slice(1);
    expect(cards).toHaveLength(3);
    const [active, paused, revoked] = cards.map((card) => textOf(card));
    expect(active).toContain('They can');
    expect(active).toContain('Can open');
    expect(active).toContain('Passport summary');
    // A document-limited grant shows no profile details.
    expect(active).toContain('none of your profile details');
    expect(paused).toContain('They could');
    expect(paused).toContain('They cannot see these without Preview documents.');
    expect(revoked).toContain('They could');
    expect(revoked).toContain('Ended');
    expect(revoked).not.toMatch(/They can(?!not)/);
    expect(cards[2]).not.toContain('scope-row-warning');
    expect(revoked).toContain('when you revoked it');
  });

  it('a grant past its end date reads as ended even before its status catches up', async () => {
    mocks.listAccessForApplicantDetailed.mockResolvedValue({
      ok: true,
      value: [{ ...grant('ACTIVE'), expiryAt: new Date('2020-01-01') }],
    });
    const card = textOf((await render()).split('class="row sharing-grant"')[1] ?? '');
    expect(card).toContain('They could');
    expect(card).toContain('Ended');
    expect(card).not.toMatch(/They can(?!not)/);
  });
});

describe('Share from the Record (WP-V3 part 2)', () => {
  const renderWith = (document: string | string[]) =>
    renderServer(
      Page({
        params: Promise.resolve({ id: 'owned' }),
        searchParams: Promise.resolve({ document }),
      }),
    );
  it('starts the new request with the one document chosen on the Record', async () => {
    const [form] = stubProps<{ initialDocumentId?: string }>(
      await renderWith('passport'),
      'GrantForm',
    );
    expect(form?.initialDocumentId).toBe('passport');
  });
  it("ignores a document that is not this person's, or a repeated value", async () => {
    for (const value of ['someone-else', ['passport', 'passport']]) {
      const [form] = stubProps<{ initialDocumentId?: string }>(
        await renderWith(value),
        'GrantForm',
      );
      expect(form).toBeDefined();
      expect(form?.initialDocumentId).toBeUndefined();
    }
  });
  it('without a choice the form starts as before', async () => {
    const [form] = stubProps<{ initialDocumentId?: string }>(await render(), 'GrantForm');
    expect(form?.initialDocumentId).toBeUndefined();
  });
});

describe('per-case sharing exceptions on the Sharing page', () => {
  const exception = {
    missionId: 'case-2',
    missionTitle: 'Japan trip 2026',
    since: new Date(),
    reachedByAnotherGrant: false,
  };
  it('lists the cases an all-cases access does not cover, for live access only', async () => {
    mocks.listAccessForApplicantDetailed.mockResolvedValue({
      ok: true,
      value: [
        { ...grant('ACTIVE', 'live'), caseExceptions: [exception] },
        { ...grant('REVOKED', 'ended'), caseExceptions: [exception] },
        { ...grant('ACTIVE', 'case-only'), missionId: 'case-1', caseExceptions: [] },
        { ...grant('PAUSED', 'none'), caseExceptions: [] },
      ],
    });
    const html = await render();
    const lists = stubProps<{
      grantId: string;
      applicantId: string;
      recipientLabel: string;
      exceptions: { missionId: string; title: string }[];
    }>(html, 'CaseExceptions');
    expect(lists).toEqual([
      {
        applicantId: 'owned',
        grantId: 'live',
        recipientLabel: 'Synthetic recipient',
        exceptions: [{ missionId: 'case-2', title: 'Japan trip 2026', sharedSeparately: false }],
      },
    ]);
  });
  it('says when the same recipient still sees an excluded case through another access', async () => {
    mocks.listAccessForApplicantDetailed.mockResolvedValue({
      ok: true,
      value: [
        {
          ...grant('ACTIVE', 'live'),
          caseExceptions: [{ ...exception, reachedByAnotherGrant: true }],
        },
      ],
    });
    const [list] = stubProps<{ exceptions: { sharedSeparately: boolean }[] }>(
      await render(),
      'CaseExceptions',
    );
    expect(list?.exceptions).toEqual([
      { missionId: 'case-2', title: 'Japan trip 2026', sharedSeparately: true },
    ]);
  });
  it('names the cases a pending all-cases invitation will not cover, read through the access gate', async () => {
    vi.stubEnv('PERSONAL_SHARING_INVITATIONS_ENABLED', 'true');
    try {
      const later = new Date(Date.now() + 86_400_000);
      mocks.listSharingInvitations.mockResolvedValue([
        {
          id: 'inv-1',
          email: 'friend@example.test',
          status: 'PENDING',
          purpose: 'Visa review',
          missionId: null,
          expiresAt: later,
        },
        {
          id: 'inv-2',
          email: 'old@example.test',
          status: 'REVOKED',
          purpose: 'Visa review',
          missionId: null,
          expiresAt: later,
        },
      ]);
      mocks.requireAccess.mockResolvedValue({ ok: true, value: { proof: 'owner' } });
      mocks.listInvitationCaseExceptions.mockResolvedValue({
        ok: true,
        value: [
          {
            invitationId: 'inv-1',
            missionId: 'case-2',
            missionTitle: 'Japan trip 2026',
            since: new Date(),
          },
          {
            invitationId: 'inv-2',
            missionId: 'case-3',
            missionTitle: 'Canada study',
            since: new Date(),
          },
        ],
      });
      const text = textOf(await render());
      expect(mocks.requireAccess).toHaveBeenCalledWith(
        {},
        expect.anything(),
        'VIEW_METADATA',
        { applicantId: 'owned' },
        { purpose: 'owner_case_sharing' },
      );
      expect(mocks.listInvitationCaseExceptions).toHaveBeenCalledWith({ proof: 'owner' });
      expect(text).toContain('Not Shared: Japan trip 2026');
      // Only pending invitations list their exceptions.
      expect(text).not.toContain('Canada study');

      // A refused gate shows nothing rather than failing the page.
      mocks.requireAccess.mockResolvedValue({ ok: false, error: { code: 'forbidden' } });
      mocks.listInvitationCaseExceptions.mockClear();
      expect(textOf(await render())).not.toContain('Japan trip 2026');
      expect(mocks.listInvitationCaseExceptions).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it('shows nothing for access that has run out', async () => {
    mocks.listAccessForApplicantDetailed.mockResolvedValue({
      ok: true,
      value: [
        {
          ...grant('ACTIVE', 'old'),
          expiryAt: new Date(Date.now() - 1000).toISOString(),
          caseExceptions: [exception],
        },
      ],
    });
    expect(stubProps(await render(), 'CaseExceptions')).toHaveLength(0);
  });
});

describe('AI Connections on the Sharing page', () => {
  type SectionProps = {
    applicantId: string;
    list: { available: boolean; active: unknown[] };
    connectorOn: boolean;
    notice?: string;
    cases: { id: string; title: string }[];
    returning?: {
      connectionId: string;
      choices: { layers: string[]; suggestChanges: boolean };
      duration: string;
    };
  };
  const renderWith = (search: Record<string, string> = {}) =>
    renderServer(
      Page({ params: Promise.resolve({ id: 'owned' }), searchParams: Promise.resolve(search) }),
    );

  it('reads the connections through the gate as the owner, even while connecting is off', async () => {
    vi.stubEnv('AI_CONNECTOR_ENABLED', 'false');
    try {
      const html = await renderWith({ ai: 'off' });
      expect(mocks.requireAccess).toHaveBeenCalledWith(
        {},
        expect.anything(),
        'VIEW_METADATA',
        { applicantId: 'owned' },
        { purpose: 'ai_connection' },
      );
      expect(mocks.listAiConnections).toHaveBeenCalledWith({ proof: 'owner' });
      const [props] = stubProps<SectionProps>(html, 'AiConnectionsSection');
      expect(props).toMatchObject({ applicantId: 'owned', connectorOn: false, notice: 'off' });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('passes the switch on, ignores an unknown notice, and survives a refused gate', async () => {
    vi.stubEnv('AI_CONNECTOR_ENABLED', 'true');
    try {
      const [on] = stubProps<SectionProps>(
        await renderWith({ ai: 'oops' }),
        'AiConnectionsSection',
      );
      expect(on?.connectorOn).toBe(true);
      expect(on?.notice).toBeUndefined();
      mocks.requireAccess.mockResolvedValue({ ok: false, error: { code: 'forbidden' } });
      mocks.listAiConnections.mockClear();
      const [refused] = stubProps<SectionProps>(await renderWith(), 'AiConnectionsSection');
      expect(mocks.listAiConnections).not.toHaveBeenCalled();
      expect(refused?.list).toEqual({
        available: false,
        active: [],
        activeTotal: 0,
        recentlyEnded: [],
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('offers the current cases and reopens Change Access with the choices from a sign-in check', async () => {
    vi.stubEnv('AI_CONNECTOR_ENABLED', 'true');
    try {
      const html0 = await renderWith();
      expect(mocks.listMissions).not.toHaveBeenCalled();
      expect(stubProps<SectionProps>(html0, 'AiConnectionsSection')[0]?.cases).toEqual([]);
      mocks.listAiConnections.mockResolvedValue({
        ok: true,
        value: { available: true, active: [{ id: 'c1', scopes: ['identity'] }], recentlyEnded: [] },
      });
      mocks.listMissions.mockResolvedValue({
        ok: true,
        value: [
          { id: 'm1', title: 'UK Visit', state: 'ACTIVE' },
          { id: 'm2', title: 'Old Trip', state: 'CLOSED' },
        ],
      });
      const [props] = stubProps<SectionProps>(
        await renderWith({
          ai_change: 'c1',
          choice_layers: 'identity',
          choice_cases: 'm1',
          choice_duration: 'keep',
          // A crafted link: Suggest Changes is never read from the address (S21 round 3).
          choice_suggest: '1',
        }),
        'AiConnectionsSection',
      );
      expect(props?.cases).toEqual([{ id: 'm1', title: 'UK Visit' }]);
      expect(props?.returning).toMatchObject({
        connectionId: 'c1',
        choices: { layers: ['identity'], suggestChanges: false },
        duration: 'keep',
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('after a change to access, the reloaded page says what changed (CCD quiet closure)', () => {
  const renderDone = (done: string) =>
    renderServer(
      Page({ params: Promise.resolve({ id: 'owned' }), searchParams: Promise.resolve({ done }) }),
    );

  it.each([
    ['revoked', 'Access revoked. They lose it on their next request.'],
    ['paused', 'Access paused. They cannot see anything until you resume it.'],
    ['resumed', 'Access resumed. They can see what you shared again.'],
    ['invitation-withdrawn', 'Invitation withdrawn. Its link no longer works.'],
    [
      'invitation-not-withdrawn',
      'The invitation could not be withdrawn. They may have taken it up already, so check who has access below.',
    ],
  ])('%s', async (done, line) => {
    const html = await renderDone(done);
    expect(html).toContain(`<p class="notice notice-ok u-mb-100">${line}</p>`);
  });

  it('shows only those fixed words, never text from the address', async () => {
    for (const done of ['Your access was stolen', 'toString', '__proto__', '']) {
      const html = await renderDone(done);
      expect(html, done).not.toContain('notice-ok');
      expect(html, done).not.toContain('stolen');
    }
  });
});

describe('the AI app feature states (S28 round 4)', () => {
  it('reads AI App Suggestions through the drafts read’s own proof, even when the connection read is refused', async () => {
    mocks.requireAccess.mockImplementation(
      async (
        _db: unknown,
        _who: unknown,
        _action: unknown,
        _target: unknown,
        options: { purpose: string },
      ) =>
        options.purpose === 'ai_drafts'
          ? { ok: true, value: { proof: 'drafts' } }
          : { ok: false, error: { code: 'forbidden' } },
    );
    mocks.listAiDrafts.mockResolvedValue({
      available: true,
      drafts: [
        {
          id: 'd1',
          title: 'Synthetic draft title',
          body: 'Synthetic draft body',
          caseTitle: null,
          appName: 'Synthetic App',
          appHost: null,
          createdAt: new Date('2026-10-30T00:00:00Z'),
        },
      ],
      more: 0,
    });
    mocks.getAiFeatureStates.mockResolvedValue({
      ai_app_suggestions: {
        feature: 'ai_app_suggestions',
        available: true,
        reason: null,
        dailyLimit: 15,
      },
    });
    const html = await render();
    expect(mocks.listAiConnections).not.toHaveBeenCalled();
    expect(mocks.getAiFeatureStates).toHaveBeenCalledTimes(1);
    expect(mocks.getAiFeatureStates).toHaveBeenCalledWith({}, ['ai_app_suggestions'], {
      proof: { proof: 'drafts' },
    });
    expect(
      stubProps<{ suggestionsAvailable: boolean }>(html, 'AiConnectionsSection')[0],
    ).toMatchObject({
      suggestionsAvailable: true,
    });
    expect(textOf(html)).toContain('Synthetic draft title');
  });

  it('reads no feature state when there is nothing to show it for', async () => {
    await render();
    expect(mocks.getAiFeatureStates).not.toHaveBeenCalled();
  });
});

describe('agency AI tools on an agency grant (S22)', () => {
  const agencyGrant = (actions: string[]) => ({
    ...grant('ACTIVE', 'agency-grant'),
    recipient: { label: 'Harbor Visas', kind: 'organization' },
    actions,
  });

  it('offers the choice once it can be stored, starting from what is stored, and says AI Tools Allowed when on', async () => {
    mocks.aiAssistAvailable.mockResolvedValue(true);
    mocks.listAccessForApplicantDetailed.mockResolvedValue({
      ok: true,
      value: [agencyGrant(['VIEW_METADATA', 'AI_ASSIST'])],
    });
    const html = await render();
    expect(stubProps(html, 'GrantAiChoice')).toEqual([
      { applicantId: 'owned', grantId: 'agency-grant', agencyName: 'Harbor Visas', allowed: true },
    ]);
    const text = textOf(html);
    expect(text).toContain('AI Tools Allowed');
    // The permission sentence never lists it as one more thing the grant allows.
    expect(text).not.toContain('use ai tools on what i share');
  });

  it('shows no choice before the update, or for a person', async () => {
    mocks.aiAssistAvailable.mockResolvedValue(false);
    mocks.listAccessForApplicantDetailed.mockResolvedValue({
      ok: true,
      value: [agencyGrant(['VIEW_METADATA']), grant('ACTIVE', 'person-grant')],
    });
    expect(stubProps(await render(), 'GrantAiChoice')).toEqual([]);
    mocks.aiAssistAvailable.mockResolvedValue(true);
    expect(
      stubProps(await render(), 'GrantAiChoice').map((p) => Reflect.get(p, 'grantId')),
    ).toEqual(['agency-grant']);
  });

  it('names the agency and the app in the Access Log', async () => {
    mocks.listAuditEventsForApplicant.mockResolvedValue([
      {
        seq: 9,
        eventType: 'AI_CONTEXT_SERVED',
        actorEmail: 'owner@agency.example',
        action: null,
        result: 'ALLOWED',
        occurredAt: new Date('2026-10-30T10:00:00Z'),
        agencyAi: { agencyName: 'Harbor Visas', appHost: 'claude.ai' },
      },
    ]);
    expect(textOf(await render())).toContain('Agency AI Tools: Harbor Visas via claude.ai');
  });
});

describe('a long list of grants stays short (WP-SB3)', () => {
  const many = () =>
    Array.from({ length: 40 }, (_, index) =>
      grant(index < 8 ? 'ACTIVE' : index < 20 ? 'PENDING_ACCEPTANCE' : 'REVOKED', `g${index}`),
    );
  const renderAt = (search: Record<string, string>) =>
    renderServer(
      Page({ params: Promise.resolve({ id: 'owned' }), searchParams: Promise.resolve(search) }),
    );

  it('reads five grants with counts over all 40, and offers Show More', async () => {
    mocks.listAccessForApplicantDetailed.mockResolvedValue({ ok: true, value: many() });
    const html = await render();
    expect(mocks.listAccessForApplicantDetailed).toHaveBeenCalledWith({}, 'owner', 'owned', {
      limit: 5,
    });
    expect(html.split('class="row sharing-grant"')).toHaveLength(6);
    const text = textOf(html);
    expect(text).toContain('Showing 5 of 40 grants.');
    expect(text).toContain('8 active grants.');
    expect(text).toContain('32 more are waiting to be accepted or have ended.');
    expect(html).toContain('href="/app/applicant/owned/sharing?show=10#sharing-grant-6"');
    expect(html).toContain('id="sharing-grant-5"');
  });

  it('keeps each grant’s details behind its own Grant Details expander', async () => {
    mocks.listAccessForApplicantDetailed.mockResolvedValue({ ok: true, value: many() });
    const html = await render();
    expect(html.match(/<details class="sharing-grant-details"/g)).toHaveLength(5);
    expect(html).not.toMatch(/<details class="sharing-grant-details"[^>]*open/);
    expect(textOf(html)).toContain('Grant Details for Synthetic recipient');
  });

  it('grows by five with each Show More and clamps a hand-edited address', async () => {
    mocks.listAccessForApplicantDetailed.mockResolvedValue({ ok: true, value: many() });
    await renderAt({ show: '10' });
    expect(mocks.listAccessForApplicantDetailed).toHaveBeenLastCalledWith({}, 'owner', 'owned', {
      limit: 10,
    });
    await renderAt({ show: '99999' });
    expect(mocks.listAccessForApplicantDetailed).toHaveBeenLastCalledWith({}, 'owner', 'owned', {
      limit: 100,
    });
    const html = await renderAt({ show: '<script>' });
    expect(mocks.listAccessForApplicantDetailed).toHaveBeenLastCalledWith({}, 'owner', 'owned', {
      limit: 5,
    });
    expect(html).not.toContain('<script>');
  });

  it('says every grant shows, with no link, once they all fit', async () => {
    mocks.listAccessForApplicantDetailed.mockResolvedValue({
      ok: true,
      value: many().slice(0, 3),
    });
    const html = await render();
    expect(textOf(html)).toContain('Showing all 3 grants.');
    expect(html).not.toContain('show=10');
  });

  it('previews new matches only for the grants on the page', async () => {
    mocks.listAccessForApplicantDetailed.mockResolvedValue({
      ok: true,
      value: many().map((item) => ({ ...item, categories: ['IDENTITY'] })),
    });
    mocks.previewScopeExpansion.mockResolvedValue({ ok: true, value: [] });
    await render();
    expect(mocks.previewScopeExpansion).toHaveBeenCalledTimes(5);
  });

  it('keeps the access log in its fixed panel with its filters', async () => {
    mocks.listAuditEventsForApplicant.mockResolvedValue(
      Array.from({ length: 300 }, (_, index) => ({
        seq: 1000 - index,
        eventType: 'DOCUMENT_VIEWED',
        actorEmail: `viewer${index % 3}@example.test`,
        action: 'VIEW',
        result: 'ALLOWED',
        occurredAt: new Date(Date.UTC(2026, 9, 1, 0, index)),
        agencyAi: null,
      })),
    );
    const html = await render();
    expect(html).toContain('activity-log-scroll');
    expect(html).toContain('aria-label="Access Log Entries"');
  });
});
