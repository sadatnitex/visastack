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
  getWalletView: vi.fn(),
  accountPrincipal: vi.fn(),
  requireAccess: vi.fn(),
  listDeadlineClock: vi.fn(),
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
  service.getWalletView.mockResolvedValue({ ok: true, value: [] });
  service.listPendingProposals.mockResolvedValue([]);
  service.listMissions.mockResolvedValue({ ok: true, value: [] });
  service.listEvidenceRequestsForApplicant.mockResolvedValue({ ok: true, value: [] });
  service.listAccessForApplicant.mockResolvedValue({ ok: true, value: [] });
  service.listApplicantAssurance.mockResolvedValue({ ok: true, value: [] });
  service.accountPrincipal.mockReturnValue({ kind: 'account', accountId: 'owner' });
  service.requireAccess.mockResolvedValue({
    ok: true,
    value: { actor: { kind: 'applicant_owner' }, applicantId: 'person' },
  });
  service.listDeadlineClock.mockResolvedValue({
    ok: true,
    value: { applicantId: 'person', entries: [] },
  });
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
      'Active Visa Cases',
      'Documents in Your Wallet',
      'Items Needing Attention',
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
  it('counts what needs attention in agreeing words: "1 item needs", "2 items need"', async () => {
    service.listPendingProposals.mockResolvedValue([{ id: 'p1', fieldKey: 'given_name' }]);
    expect(renderToStaticMarkup(await overview(params))).toContain(
      '1 item needs a decision or a closer look.',
    );
    service.listPendingProposals.mockResolvedValue([
      { id: 'p1', fieldKey: 'given_name' },
      { id: 'p2', fieldKey: 'family_name' },
    ]);
    const html = renderToStaticMarkup(await overview(params));
    expect(html).toContain('2 items need a decision or a closer look.');
    expect(html).not.toContain('1 items');
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
    expect(html).toContain('aria-label="2 of 5 items ready"');
    expect(html).toContain('>2 of 5 items ready<');
    // The case's progress is the ring now; the bar that remains on the page is profile completeness.
    const checklist = html.slice(
      html.indexOf('traveller-checklist'),
      html.indexOf('Continue Case'),
    );
    expect(checklist).not.toContain('meter');
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
      'Essentials Added',
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
  it('leads a new profile with the essentials, never the size of the whole profile', async () => {
    const html = renderToStaticMarkup(await profile(params));
    const banner = html.slice(html.indexOf('profile-completeness'), html.indexOf('split-main'));
    expect(banner).toContain('Essentials Added');
    expect(banner).toContain('<strong>0 of 12</strong>');
    expect(banner).toContain('The details most visa forms ask for first.');
    expect(banner).not.toContain('Full profile');
    expect(banner.replace('style="width:0%"', '')).not.toContain('%');
  });
  it('shows the full profile figure in the banner once every essential is added', async () => {
    const saved = (fieldKey: string, repeatingRecordKey: string | null = null) => ({
      factId: `fact-${fieldKey}`,
      fieldKey,
      repeatingRecordKey,
      value: 'Synthetic',
      status: 'DECLARED',
      updatedAt: '2026-10-10T12:00:00Z',
      method: 'MANUAL',
    });
    const { PROFILE_ESSENTIALS } = await import('./profile-essentials');
    service.listApplicantProfile.mockResolvedValue([
      ...PROFILE_ESSENTIALS.filter((e) => e.kind === 'field').map((e) => saved(e.key)),
      saved('address_line', 'home'),
    ]);
    const html = renderToStaticMarkup(await profile(params));
    const banner = html.slice(html.indexOf('profile-completeness'), html.indexOf('split-main'));
    expect(banner).toContain('<strong>12 of 12</strong>');
    expect(banner).toMatch(/Full profile: \d+% of the details in your \d+ open sections\./);
  });
  it('points a new person at the essentials on the overview, then at the full profile', async () => {
    let html = renderToStaticMarkup(await overview(params));
    expect(html).toContain('Add Your Essentials');
    expect(html).toContain('0 of 12 essentials added: the details most visa forms ask for first.');
    expect(html).toContain('Essentials added');
    expect(html).not.toContain('Details with values in open sections');
    expect(html).not.toContain('Continue Your Profile');

    service.getProfileSectionState.mockResolvedValue({
      activated: new Set(),
      notApplicable: new Set([
        'given_name',
        'family_name',
        'date_of_birth',
        'sex',
        'place_of_birth',
        'nationality',
        'passport_number',
        'passport_issue_date',
        'passport_expiry',
        'email',
        'phone',
      ]),
      noneDeclared: new Set(['address']),
    });
    html = renderToStaticMarkup(await overview(params));
    expect(html).not.toContain('Add Your Essentials');
    expect(html).toContain('Continue Your Profile');
    expect(html).toContain('Details with values in open sections');
  });
  it('keeps permission review reachable while editing is disabled', async () => {
    service.hasConsent.mockResolvedValue(false);
    const html = renderToStaticMarkup(await profile(params));
    expect(html).toContain('/app#permissions');
    expect(html).not.toContain('Versioned editor');
  });
});

describe("the deadline clock on a person's overview (Growth G5)", () => {
  const entry = (overrides: Record<string, unknown>) => ({
    key: 'document_expires:d1',
    kind: 'document_expires',
    applicantId: 'person',
    applicantName: 'Synthetic Traveller',
    date: '2026-11-07',
    daysUntil: 12,
    urgency: 'month',
    docType: 'PASSPORT',
    subject: null,
    label: null,
    doubt: null,
    caseId: null,
    href: '/app/applicant/person/expiry',
    ...overrides,
  });

  it("reads the person's dates through the gate as the owner, three at most", async () => {
    renderToStaticMarkup(await overview(params));
    expect(service.requireAccess).toHaveBeenCalledWith(
      {},
      { kind: 'account', accountId: 'owner' },
      'VIEW_METADATA',
      { applicantId: 'person' },
      { purpose: 'self' },
    );
    expect(service.listDeadlineClock).toHaveBeenCalledWith(
      expect.objectContaining({ applicantId: 'person' }),
      expect.objectContaining({ limit: 3 }),
    );
  });

  it('shows the dates with plain times, a tone word and a link to the full list', async () => {
    service.listDeadlineClock.mockResolvedValue({
      ok: true,
      value: {
        applicantId: 'person',
        entries: [
          entry({
            key: 'task_due:t',
            kind: 'task_due',
            docType: null,
            label: 'Pay the visa fee',
            daysUntil: -2,
            urgency: 'overdue',
            href: '/app/mission/c1',
          }),
          entry({}),
        ],
      },
    });
    const html = renderToStaticMarkup(await overview(params));
    expect(html).toContain('Deadline Clock');
    expect(html).toContain('Pay the visa fee');
    expect(html).toContain('Was due 2 days ago');
    expect(html).toContain('Expires in 12 days');
    expect(html).toContain('Overdue');
    expect(html).toContain('Within a Month');
    expect(html).toContain('href="/app/mission/c1"');
    expect(html).toContain('See All Dates');
    // The name of the person is not repeated on their own page.
    expect(html.slice(html.indexOf('Deadline Clock'), html.indexOf('Upcoming'))).not.toContain(
      'Synthetic Traveller',
    );
  });

  it('teaches when there are no dates, with the add-document button', async () => {
    const html = renderToStaticMarkup(await overview(params));
    const clock = html.slice(html.indexOf('Deadline Clock'), html.indexOf('>Upcoming<'));
    expect(clock).toContain('No Dates Yet');
    expect(clock).toContain(
      'Add a passport and its expiry date appears here, so you hear about it before it matters.',
    );
    expect(clock).toContain('href="/app/applicant/person/documents"');
    expect(clock).toContain('Add a Document');
  });

  it('marks a date it is unsure of', async () => {
    service.listDeadlineClock.mockResolvedValue({
      ok: true,
      value: {
        applicantId: 'person',
        entries: [entry({ docType: null, doubt: 'kind_not_accepted' })],
      },
    });
    const html = renderToStaticMarkup(await overview(params));
    expect(html).toContain('Check This Date');
    expect(html).toContain('if the date is right');
  });

  it('says dates are unavailable, not empty, when they cannot be read', async () => {
    service.listDeadlineClock.mockResolvedValue({ ok: false, error: { code: 'upstream_error' } });
    const html = renderToStaticMarkup(await overview(params));
    expect(html).toContain('Dates are unavailable right now.');
    expect(html).not.toContain('No Dates Yet');
  });

  it("is not read at all for a person who is not the owner's", async () => {
    service.getApplicant.mockResolvedValue({ ...person, ownerAccountId: 'foreign' });
    await expect(overview(params)).rejects.toThrow('NOT_FOUND');
    expect(service.requireAccess).not.toHaveBeenCalled();
    expect(service.listDeadlineClock).not.toHaveBeenCalled();
  });
});
