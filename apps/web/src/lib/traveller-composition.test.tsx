import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
  listApplicantAssurance: vi.fn(),
  getProfileSectionState: vi.fn(),
}));
vi.mock('@visastack/services', () => service);
vi.mock('./session', () => ({
  withSession: (callback: (ctx: unknown) => unknown) => callback({ db: {}, accountId: 'owner' }),
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
}));
vi.mock('../app/app/agency/[orgId]/case-search-form', () => ({ STAGE_LABELS: { DRAFT: 'Draft' } }));
vi.mock('../app/app/applicant/[id]/profile-editor', () => ({
  ProfileEditor: () => <div id="profile-editor">Versioned editor</div>,
}));
const { default: overview } = await import('../app/app/applicant/[id]/page');
const { default: profile } = await import('../app/app/applicant/[id]/profile/page');
const person = {
  id: 'person',
  displayName: 'Synthetic Traveller',
  relationship: 'SELF',
  ownerAccountId: 'owner',
  createdAt: new Date('2026-01-01'),
};
const params = { params: Promise.resolve({ id: 'person' }) };
beforeEach(() => {
  vi.resetAllMocks();
  service.getApplicant.mockResolvedValue(person);
  service.listApplicantProfile.mockResolvedValue([]);
  service.hasConsent.mockResolvedValue(true);
  service.listDocumentsDetailed.mockResolvedValue({ ok: true, value: [] });
  service.listPendingProposals.mockResolvedValue([]);
  service.listMissions.mockResolvedValue({ ok: true, value: [] });
  service.listEvidenceRequestsForApplicant.mockResolvedValue({ ok: true, value: [] });
  service.listAccessForApplicant.mockResolvedValue({ ok: true, value: [] });
  service.listApplicantAssurance.mockResolvedValue({ ok: true, value: [] });
  service.getProfileSectionState.mockResolvedValue({
    activated: new Set(),
    notApplicable: new Set(),
    noneDeclared: new Set(),
  });
});
describe('traveller composition and independent record guards', () => {
  it.each([
    ['overview', overview],
    ['profile', profile],
  ] as const)('%s refuses another owner before reading private facts', async (_label, page) => {
    service.getApplicant.mockResolvedValue({ ...person, ownerAccountId: 'foreign' });
    await expect(page(params)).rejects.toThrow('NOT_FOUND');
    expect(service.listApplicantProfile).not.toHaveBeenCalled();
    expect(service.listDocumentsDetailed).not.toHaveBeenCalled();
    expect(service.listApplicantAssurance).not.toHaveBeenCalled();
  });
  it('preserves all structural overview regions for an empty account without inventing a case', async () => {
    const html = renderToStaticMarkup(await overview(params));
    for (const text of [
      'Active visa cases',
      'Documents in your wallet',
      'Items needing attention',
      'Continue Where You Left Off',
      'Needs Your Attention',
      'Upcoming',
      'Recent Activity',
      'No Active Case Yet',
      'No Upcoming Case Dates',
    ])
      expect(html).toContain(text);
    expect(html).toContain('/app/applicant/person/missions');
    expect(html).not.toContain('Japan visitor');
  });
  it('uses the newest active case and actual readiness, excluding closed cases', async () => {
    const now = new Date('2026-10-11');
    service.listMissions.mockResolvedValue({
      ok: true,
      value: [
        {
          id: 'older',
          title: 'Older case',
          state: 'DRAFT',
          updatedAt: new Date('2026-09-01'),
          packVersionId: null,
        },
        {
          id: 'closed',
          title: 'Closed case',
          state: 'CLOSED',
          updatedAt: now,
          packVersionId: 'pack',
        },
        {
          id: 'latest',
          title: 'Latest case',
          state: 'DRAFT',
          updatedAt: now,
          packVersionId: 'pack',
        },
      ],
    });
    service.computeReadiness.mockResolvedValue({
      ok: true,
      value: { satisfiedRequired: 2, requiredCount: 5 },
    });
    const html = renderToStaticMarkup(await overview(params));
    expect(service.computeReadiness).toHaveBeenCalledWith({}, 'latest');
    expect(html).toContain('2 of 5 required items');
    expect(html).toContain('/app/mission/latest');
    expect(html).not.toContain('Closed case');
  });
  it('shows unavailable totals when the record service refuses a read', async () => {
    service.listDocumentsDetailed.mockResolvedValue({ ok: false, error: { code: 'forbidden' } });
    const html = renderToStaticMarkup(await overview(params));
    expect(html).toContain('Unavailable');
    expect(html).toContain('Unavailable totals are not reported as zero');
  });
  it('keeps conflict, assurance and AI review separate from completeness on the profile', async () => {
    service.listApplicantProfile.mockResolvedValue([
      {
        factId: 'fact',
        fieldKey: 'given_name',
        repeatingRecordKey: null,
        value: 'Synthetic',
        status: 'CONFLICTED',
        updatedAt: '2026-10-10T12:00:00Z',
        method: 'MANUAL',
      },
    ]);
    const html = renderToStaticMarkup(await profile(params));
    for (const text of [
      'Profile completion',
      'Profile Health',
      'Latest Changes',
      'Conflicted',
      'Versioned editor',
      'You Decide What Becomes a Fact',
      'This does not verify identity',
    ])
      expect(html).toContain(text);
    expect(html).not.toContain('Email verified');
    expect(html).toContain('/app/applicant/person/history');
  });
  it('keeps permission review reachable while editing is disabled', async () => {
    service.hasConsent.mockResolvedValue(false);
    const html = renderToStaticMarkup(await profile(params));
    expect(html).toContain('/app#permissions');
    expect(html).not.toContain('Versioned editor');
  });
});
