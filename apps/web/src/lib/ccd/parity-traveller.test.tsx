import { vi } from 'vitest';
import { renderServer } from '../next-mocks.test-support';
import { registerParity } from './parity-kit.test-support';

/** A traveller's own page (screen 03): see parity-kit.test-support.ts for how the comparison works. */

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
const depth = vi.hoisted(() => ({ level: 'auto' }));

vi.mock('@visastack/services', () => service);
vi.mock('../session', () => ({
  withSession: (callback: (ctx: unknown) => unknown) =>
    callback({ db: {}, accountId: 'owner', email: 'me@example.com' }),
}));
vi.mock('./depth.server', () => ({ readDepth: async () => depth.level }));
vi.mock('../../app/app/agency/[orgId]/case-search-form', () => ({
  STAGE_LABELS: { DRAFT: 'Draft', IN_PROGRESS: 'In Progress' },
}));

const { default: Overview } = await import('../../app/app/applicant/[id]/page');

const person = {
  id: 'person',
  displayName: 'Karim Hossain',
  relationship: 'SELF',
  ownerAccountId: 'owner',
  createdAt: new Date('2026-01-01'),
};
const params = { params: Promise.resolve({ id: 'person' }) };

function reset() {
  vi.resetAllMocks();
  depth.level = 'auto';
  service.getApplicant.mockResolvedValue(person);
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
}

const attentionItem = {
  key: 'evidence_request:r1',
  kind: 'evidence_request',
  tier: 1,
  title: 'Document Requested',
  why: 'An agency asked you for a document. Reply with a file from your documents.',
  applicantId: 'person',
  applicantName: 'Karim Hossain',
  caseId: null,
  caseTitle: 'Japan Tourist Visa',
  dueDate: '2026-10-20',
  dueState: 'overdue',
  daysUntilDue: -8,
  sentBack: false,
  count: null,
  subject: { kind: 'request', requestKind: 'DOCUMENT', docType: 'BANK_STATEMENT', fieldKey: null },
  href: '/app/applicant/person/evidence',
  createdAt: '2026-10-01T00:00:00.000Z',
};

const case1 = {
  id: 'case-1',
  title: 'Japan Tourist Visa',
  state: 'IN_PROGRESS',
  updatedAt: new Date('2026-10-11'),
  targetDeadline: new Date('2027-01-10'),
  travelStartDate: new Date('2027-02-01'),
  jurisdiction: 'Japan',
  serviceCategory: 'Tourist',
  packVersionId: 'pack-1',
};

registerParity({
  name: 'traveller',
  reset,
  render: async () => await renderServer(Overview(params)),
  states: [
    { name: 'empty account', setup: () => undefined },
    {
      name: 'core processing off',
      setup: () => service.hasConsent.mockResolvedValue(false),
    },
    {
      name: 'a request, suggested details and a flagged document',
      setup: () => {
        service.listEvidenceRequestsForApplicant.mockResolvedValue({
          ok: true,
          value: [{ id: 'r1', status: 'OPEN' }],
        });
        service.listPendingProposals.mockResolvedValue([
          { id: 'p1', fieldKey: 'given_name' },
          { id: 'p2', fieldKey: 'family_name' },
        ]);
        service.listDocumentsDetailed.mockResolvedValue({
          ok: true,
          value: [
            {
              id: 'd1',
              originalName: 'passport.pdf',
              approvedName: null,
              createdAt: new Date('2026-10-02').toISOString(),
              safetyStatus: 'QUARANTINED',
              classification: null,
            },
          ],
        });
        service.listNeedsAttention.mockResolvedValue({
          ok: true,
          value: {
            applicantId: 'person',
            applicantName: 'Karim Hossain',
            items: [attentionItem],
            activeCases: [],
            activeCaseCount: 0,
            requests: { waitingOnYou: 1, withAgency: 0 },
          },
        });
      },
    },
    {
      name: 'an active case with a checklist, a second case and a grant',
      setup: () => {
        service.listMissions.mockResolvedValue({
          ok: true,
          value: [
            case1,
            {
              ...case1,
              id: 'case-2',
              title: 'Korea Visit',
              updatedAt: new Date('2026-09-01'),
              packVersionId: null,
            },
          ],
        });
        service.computeReadiness.mockResolvedValue({
          ok: true,
          value: { requiredCount: 8, satisfiedRequired: 6 },
        });
        service.listAccessForApplicant.mockResolvedValue({
          ok: true,
          value: [{ id: 'g1', status: 'ACTIVE' }],
        });
      },
    },
    {
      name: 'some records could not be loaded',
      setup: () => {
        service.listMissions.mockResolvedValue({ ok: false, error: { code: 'upstream_error' } });
        service.listDocumentsDetailed.mockResolvedValue({
          ok: false,
          error: { code: 'upstream_error' },
        });
        service.listAccessForApplicant.mockResolvedValue({
          ok: false,
          error: { code: 'upstream_error' },
        });
      },
    },
  ],
});
