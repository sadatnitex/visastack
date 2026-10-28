import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The calm all-clear on a traveller's page: nothing waiting, profile complete (CCD-2). */

const service = vi.hoisted(() => ({
  getApplicant: vi.fn(),
  listApplicantProfile: vi.fn(),
  hasConsent: vi.fn(),
  listDocumentsDetailed: vi.fn(),
  listPendingProposals: vi.fn(),
  listMissions: vi.fn(),
  listEvidenceRequestsForApplicant: vi.fn(),
  listAccessForApplicant: vi.fn(),
  computeReadiness: vi.fn(),
  getProfileSectionState: vi.fn(),
  accountPrincipal: vi.fn(),
  requireAccess: vi.fn(),
  listDeadlineClock: vi.fn(),
  listNeedsAttention: vi.fn(),
}));

vi.mock('@visastack/services', () => service);
vi.mock('./session', () => ({
  withSession: (callback: (ctx: unknown) => unknown) => callback({ db: {}, accountId: 'owner' }),
}));
vi.mock('./ccd/depth.server', () => ({ readDepth: async () => 'auto' }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
}));
vi.mock('../app/app/agency/[orgId]/case-search-form', () => ({
  STAGE_LABELS: { IN_PROGRESS: 'In Progress' },
}));
vi.mock('./master-profile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./master-profile')>()),
  completionOf: () => ({ answered: 10, total: 10, percent: 100 }),
  essentialsProgress: () => ({ done: true, answered: 5, total: 5, percent: 100 }),
}));

const { default: overview } = await import('../app/app/applicant/[id]/page');
const params = { params: Promise.resolve({ id: 'person' }) };
const case1 = {
  id: 'case-1',
  title: 'Japan Tourist Visa',
  state: 'IN_PROGRESS',
  updatedAt: new Date('2026-10-11'),
  targetDeadline: null,
  travelStartDate: null,
  jurisdiction: 'Japan',
  serviceCategory: 'Tourist',
  packVersionId: null,
};

beforeEach(() => {
  vi.resetAllMocks();
  service.getApplicant.mockResolvedValue({
    id: 'person',
    displayName: 'Karim Hossain',
    ownerAccountId: 'owner',
  });
  service.listApplicantProfile.mockResolvedValue([]);
  service.hasConsent.mockResolvedValue(true);
  service.listDocumentsDetailed.mockResolvedValue({ ok: true, value: [] });
  service.listPendingProposals.mockResolvedValue([]);
  service.listMissions.mockResolvedValue({ ok: true, value: [] });
  service.listEvidenceRequestsForApplicant.mockResolvedValue({ ok: true, value: [] });
  service.listAccessForApplicant.mockResolvedValue({ ok: true, value: [] });
  service.accountPrincipal.mockReturnValue({ kind: 'account', accountId: 'owner' });
  service.requireAccess.mockResolvedValue({
    ok: true,
    value: { actor: { kind: 'applicant_owner' }, applicantId: 'person' },
  });
  service.listDeadlineClock.mockResolvedValue({
    ok: true,
    value: { applicantId: 'person', entries: [] },
  });
  service.listNeedsAttention.mockResolvedValue({
    ok: true,
    value: {
      applicantId: 'person',
      applicantName: 'Karim Hossain',
      items: [],
      activeCases: [],
      activeCaseCount: 0,
      requests: { waitingOnYou: 0, withAgency: 0 },
    },
  });
  service.getProfileSectionState.mockResolvedValue({
    activated: new Set(),
    notApplicable: new Set(),
    noneDeclared: new Set(),
  });
});

describe('a traveller with nothing waiting and a complete profile', () => {
  it('says nothing needs them and offers Continue Case as the one primary action', async () => {
    service.listMissions.mockResolvedValue({ ok: true, value: [case1] });
    const html = renderToStaticMarkup(await overview(params));
    expect(html).toContain('Nothing Needs You Right Now');
    expect(html).toContain('Pick up Japan Tourist Visa where you left off.');
    expect(html).toContain('>Continue Case</a>');
    expect(html.match(/class="btn btn-primary"/g)?.length).toBe(1);
  });

  it('offers to start a case when there is none yet', async () => {
    const html = renderToStaticMarkup(await overview(params));
    expect(html).toContain('Nothing Needs You Right Now');
    expect(html).toContain('Start a case when you plan your next trip.');
  });

  it('never says nothing is waiting when a read failed, even with a complete profile', async () => {
    service.listMissions.mockResolvedValue({ ok: true, value: [case1] });
    service.listEvidenceRequestsForApplicant.mockResolvedValue({
      ok: false,
      error: { code: 'upstream_error' },
    });
    const html = renderToStaticMarkup(await overview(params));
    expect(html).not.toContain('Nothing Needs You Right Now');
    expect(html).toContain('Start or Review a Case');
    expect(html).toContain('Some sections are unavailable');
  });

  it('never says nothing is waiting when the ranking could not be read', async () => {
    service.listMissions.mockResolvedValue({ ok: true, value: [case1] });
    service.listNeedsAttention.mockResolvedValue({ ok: false, error: { code: 'upstream_error' } });
    const html = renderToStaticMarkup(await overview(params));
    expect(html).not.toContain('Nothing Needs You Right Now');
    expect(html).toContain('Start or Review a Case');
  });
});
