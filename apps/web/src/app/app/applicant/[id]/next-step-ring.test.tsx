import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AFTER_STEP_LABEL, NOW_LABEL } from '../../../../components/ui-lift/next-step-panel';
import { buildMasterProfileView } from '../../../../lib/master-profile';
import { renderServer } from '../../../../lib/next-mocks.test-support';

/**
 * WP-PIC13: the traveller page's Next Step card shows the ring now and the ring after the step on
 * the two profile steps, from the counts the page already has, and nowhere else.
 */

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
  rankAttentionItems: vi.fn(),
}));

vi.mock('@visastack/services', () => service);
vi.mock('../../../../lib/session', () => ({
  withSession: (callback: (ctx: unknown) => unknown) =>
    callback({ db: {}, accountId: 'owner', email: 'me@example.com' }),
}));
vi.mock('../../../../lib/ccd/depth.server', () => ({ readDepth: async () => 'auto' }));
vi.mock('../../agency/[orgId]/case-search-form', () => ({
  STAGE_LABELS: { DRAFT: 'Draft', IN_PROGRESS: 'In Progress' },
}));

const { default: Overview } = await import('./page');

const params = { params: Promise.resolve({ id: 'person' }) };

/** Every essential answered: a value for each detail, "none" for each record. */
function allEssentials() {
  const noChoices = new Set<string>();
  const items = buildMasterProfileView({
    entries: [],
    activated: noChoices,
    notApplicable: noChoices,
    noneDeclared: noChoices,
    suggestFor: null,
  }).essentials.items;
  return {
    entries: items.map((item) => ({ fieldKey: item.key, value: 'Filled', status: 'APPROVED' })),
    noneDeclared: new Set(items.flatMap((item) => [item.key, item.sectionKey])),
    total: items.length,
  };
}

function ringCaptions(html: string): number {
  return html.split(`>${NOW_LABEL}<`).length - 1 + html.split(`>${AFTER_STEP_LABEL}<`).length - 1;
}

/** The hero sits inside the Next Step card, between its title and its button. */
function cardHtml(html: string): string {
  const start = html.indexOf('class="next-step');
  return start < 0 ? '' : html.slice(start, html.indexOf('</section>', start));
}

beforeEach(() => {
  vi.resetAllMocks();
  service.getApplicant.mockResolvedValue({
    id: 'person',
    displayName: 'Karim Hossain',
    relationship: 'SELF',
    ownerAccountId: 'owner',
    createdAt: new Date('2026-01-01'),
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
  service.rankAttentionItems.mockImplementation((items: unknown[]) => items);
  service.getProfileSectionState.mockResolvedValue({
    activated: new Set(),
    notApplicable: new Set(),
    noneDeclared: new Set(),
  });
});

describe('the Next Step ring on the traveller page', () => {
  it('shows the ring now and after on Add Your Essentials, inside the card', async () => {
    const { total } = allEssentials();
    const html = await renderServer(Overview(params));
    const card = cardHtml(html);
    expect(card).toContain('Add Your Essentials');
    expect(ringCaptions(card)).toBe(2);
    // Now: none of the essentials; after the step: every one of them.
    expect(card).toContain(`0 of ${total}`);
    expect(card).toContain(`${total} of ${total}`);
  });

  it('shows the ring on Continue Your Profile with the profile counts', async () => {
    const { entries, noneDeclared } = allEssentials();
    service.listApplicantProfile.mockResolvedValue(entries);
    service.getProfileSectionState.mockResolvedValue({
      activated: new Set(),
      notApplicable: new Set(),
      noneDeclared,
    });
    const html = await renderServer(Overview(params));
    const card = cardHtml(html);
    expect(card).toContain('Continue Your Profile');
    expect(ringCaptions(card)).toBe(2);
  });

  it('shows no ring on any other step', async () => {
    service.hasConsent.mockResolvedValue(false);
    expect(ringCaptions(cardHtml(await renderServer(Overview(params))))).toBe(0);
    service.hasConsent.mockResolvedValue(true);
    service.listPendingProposals.mockResolvedValue([{ id: 'p1', fieldKey: 'given_name' }]);
    const html = await renderServer(Overview(params));
    expect(cardHtml(html)).toContain('Found in Your Documents');
    expect(ringCaptions(cardHtml(html))).toBe(0);
  });
});
