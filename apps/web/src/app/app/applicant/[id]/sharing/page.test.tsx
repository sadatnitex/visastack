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
}));
vi.mock('@visastack/services', async (original) => ({
  ...(await original<typeof import('@visastack/services')>()),
  ...mocks,
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
    returning?: { connectionId: string; choices: { layers: string[] }; duration: string };
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
        value: { available: true, active: [{ id: 'c1' }], recentlyEnded: [] },
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
        }),
        'AiConnectionsSection',
      );
      expect(props?.cases).toEqual([{ id: 'm1', title: 'UK Visit' }]);
      expect(props?.returning).toMatchObject({
        connectionId: 'c1',
        choices: { layers: ['identity'] },
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
      'The invitation could not be withdrawn. It may have been accepted already, so check who has access below.',
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
