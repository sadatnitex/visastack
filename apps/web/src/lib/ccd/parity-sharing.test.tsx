import { JSDOM } from 'jsdom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer, stub } from '../next-mocks.test-support';
import { registerParity } from './parity-kit.test-support';

/** Sharing (screen 11): see parity-kit.test-support.ts for how the comparison works. */

const state = vi.hoisted(() => ({
  access: { ok: true, value: [] } as unknown,
  documents: { ok: true, value: [] } as unknown,
  audit: [] as unknown[],
  invitations: [] as unknown[],
  expansions: [] as unknown[],
  depth: 'auto',
}));

vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  getApplicant: async () => ({
    id: 'person',
    ownerAccountId: 'acct-1',
    displayName: 'Karim Rahman',
    timezone: 'Asia/Dhaka',
  }),
  listAccessForApplicantDetailed: async () => state.access,
  listDocumentsDetailed: async () => state.documents,
  listAuditEventsForApplicant: async () => state.audit,
  listApplicantProfile: async () => [],
  previewScopeExpansion: async () => ({ ok: true, value: state.expansions }),
  listSharingInvitations: async () => state.invitations,
  listInvitationCaseExceptions: async () => ({
    ok: true,
    value: [
      {
        invitationId: 'inv-1',
        missionId: 'case-2',
        missionTitle: 'Japan trip 2026',
        since: new Date('2026-10-01T00:00:00Z'),
      },
    ],
  }),
  requireAccess: async () => ({ ok: true, value: { proof: 'owner' } }),
  listAiConnections: async () => ({
    ok: true,
    value: { available: true, active: [], recentlyEnded: [] },
  }),
  listMissions: async () => ({ ok: true, value: [] }),
}));
vi.mock('../locale', () => ({ getLocale: async () => 'en' }));
vi.mock('../session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'traveller@example.com' }),
}));
vi.mock('./depth.server', () => ({ readDepth: async () => state.depth }));
vi.mock('../../app/app/applicant/[id]/sharing/actions', () => ({
  revokeSharingInvitationAction: vi.fn(),
}));
vi.mock('../../app/app/applicant/[id]/sharing/grant-form', () => ({
  GrantForm: stub('GrantForm'),
}));
vi.mock('../../app/app/applicant/[id]/sharing/grant-op-buttons', () => ({
  GrantOpButtons: stub('GrantOpButtons'),
}));
vi.mock('../../app/app/applicant/[id]/sharing/scope-expansion-form', () => ({
  ScopeExpansionForm: stub('ScopeExpansionForm'),
}));
vi.mock('../../app/app/applicant/[id]/sharing/case-exceptions', () => ({
  CaseExceptions: stub('CaseExceptions'),
}));
vi.mock('../../app/app/applicant/[id]/sharing/ai-connections', () => ({
  AiConnectionsSection: stub('AiConnectionsSection'),
}));

const { default: SharingPage } = await import('../../app/app/applicant/[id]/sharing/page');

const grant = (status: string, id: string, over: Record<string, unknown> = {}) => ({
  id,
  status,
  recipient: { label: `Recipient ${id}`, kind: 'account' },
  actions: ['VIEW_METADATA'],
  missionId: null,
  categories: null,
  documentIds: ['passport'],
  purpose: 'Visa review',
  expiryAt: null,
  acceptedAt: null,
  caseExceptions: [] as unknown[],
  ...over,
});

const passport = {
  id: 'passport',
  originalName: 'Passport',
  approvedName: null,
  docType: 'PASSPORT',
};

registerParity({
  name: 'sharing',
  reset: () => {
    vi.unstubAllEnvs();
    state.access = { ok: true, value: [] };
    state.documents = { ok: true, value: [passport] };
    state.audit = [];
    state.invitations = [];
    state.expansions = [];
    state.depth = 'auto';
  },
  render: async () =>
    await renderServer(SharingPage({ params: Promise.resolve({ id: 'person' }) })),
  states: [
    { name: 'nobody has access', setup: () => undefined },
    {
      name: 'active, paused, pending, revoked, with exceptions, expansions, invitations and a log',
      setup: () => {
        vi.stubEnv('PERSONAL_SHARING_INVITATIONS_ENABLED', 'true');
        state.access = {
          ok: true,
          value: [
            grant('ACTIVE', 'g1', {
              acceptedAt: new Date('2026-10-02T08:00:00Z'),
              categories: ['identity'],
              documentIds: null,
              caseExceptions: [
                { missionId: 'case-2', missionTitle: 'Japan trip 2026', since: new Date() },
              ],
            }),
            grant('PAUSED', 'g2', { expiryAt: new Date('2030-01-01T00:00:00Z') }),
            grant('PENDING_ACCEPTANCE', 'g3', {
              recipient: { label: 'Atlas Visa Agency', kind: 'organization' },
            }),
            grant('REVOKED', 'g4'),
          ],
        };
        state.expansions = [{ id: 'x1', label: 'New passport scan' }];
        state.invitations = [
          {
            id: 'inv-1',
            email: 'friend@example.test',
            status: 'PENDING',
            purpose: 'Visa review',
            missionId: null,
            expiresAt: new Date('2030-01-01T00:00:00Z'),
          },
          {
            id: 'inv-2',
            email: 'old@example.test',
            status: 'REVOKED',
            purpose: 'Visa review',
            missionId: null,
            expiresAt: new Date('2030-01-01T00:00:00Z'),
          },
        ];
        state.audit = [
          {
            seq: 1,
            eventType: 'DOCUMENT_VIEWED',
            actorEmail: 'agent@example.test',
            result: 'ALLOWED',
            occurredAt: new Date('2026-10-20T08:00:00Z'),
          },
          {
            seq: 2,
            eventType: 'DOCUMENT_DOWNLOAD',
            actorEmail: null,
            result: 'DENIED',
            occurredAt: new Date('2026-10-21T08:00:00Z'),
          },
        ];
      },
    },
    {
      name: 'access records could not be read',
      setup: () => {
        state.access = { ok: false };
        state.documents = { ok: false };
      },
    },
  ],
});

describe('sharing levels', () => {
  const page = async (search: Record<string, string> = {}) =>
    new JSDOM(
      await renderServer(
        SharingPage({
          params: Promise.resolve({ id: 'person' }),
          searchParams: Promise.resolve(search),
        }),
      ),
    ).window.document;
  const levelOf = (el: Element | null | undefined) => el?.getAttribute('data-level') ?? 'glance';
  const rowFor = (doc: Document, label: string) =>
    [...doc.querySelectorAll('.sharing-grant')].find((row) => row.textContent?.includes(label));
  beforeEach(() => {
    state.access = { ok: true, value: [] };
    state.documents = { ok: true, value: [passport] };
  });

  it('shows who can reach the record now, with Pause and Revoke and the warning, at Glance', async () => {
    state.access = {
      ok: true,
      value: [
        grant('ACTIVE', 'g1'),
        grant('PAUSED', 'g2'),
        grant('PENDING_ACCEPTANCE', 'g3'),
        grant('REVOKED', 'g4'),
        grant('ACTIVE', 'g5', { expiryAt: new Date('2020-01-01T00:00:00Z') }),
      ],
    };
    const doc = await page();
    for (const id of ['g1', 'g2']) {
      const row = rowFor(doc, `Recipient ${id}`);
      expect(levelOf(row)).toBe('glance');
      expect(levelOf(row?.querySelector('[data-stub="GrantOpButtons"]'))).toBe('glance');
    }
    for (const id of ['g3', 'g4', 'g5'])
      expect(levelOf(rowFor(doc, `Recipient ${id}`))).toBe('browse');
    const warning = [...doc.querySelectorAll('p.notice')].find((p) =>
      p.textContent?.includes('Pausing or revoking stops all'),
    );
    expect(levelOf(warning)).toBe('glance');
    expect(doc.querySelector('[data-only="glance"]')?.textContent).toContain(
      '3 more are waiting to be accepted or have ended.',
    );
    expect(levelOf(doc.getElementById('new-sharing-request'))).toBe('everything');
  });

  it('opens the form one level earlier while nobody has access, and at Glance from Share on a document', async () => {
    expect(levelOf((await page()).getElementById('new-sharing-request'))).toBe('browse');
    expect(
      levelOf((await page({ document: 'passport' })).getElementById('new-sharing-request')),
    ).toBe('glance');
    expect(
      levelOf((await page({ document: 'not-mine' })).getElementById('new-sharing-request')),
    ).toBe('browse');
  });

  it('never treats a failed read as nobody having access', async () => {
    state.access = { ok: false };
    const doc = await page();
    expect(doc.querySelector('[role="alert"]')?.textContent).toContain(
      'This does not mean nobody has access',
    );
    expect(levelOf(doc.getElementById('new-sharing-request'))).toBe('everything');
  });
});
