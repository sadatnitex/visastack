import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer, stub, textOf } from '../../../../../lib/next-mocks.test-support';

const mocks = vi.hoisted(() => ({
  getApplicant: vi.fn(),
  hasConsent: vi.fn(),
  listPendingProposals: vi.fn(async (): Promise<unknown[]> => []),
  listApplicantProfile: vi.fn(async (): Promise<unknown[]> => []),
  listDocumentsDetailed: vi.fn(),
  requireAccess: vi.fn(),
  listDocumentReadingStates: vi.fn(),
  aiFeature: vi.fn(),
}));

vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  getApplicant: mocks.getApplicant,
  hasConsent: mocks.hasConsent,
  listPendingProposals: mocks.listPendingProposals,
  listApplicantProfile: mocks.listApplicantProfile,
  listDocumentsDetailed: mocks.listDocumentsDetailed,
  requireAccess: mocks.requireAccess,
  listDocumentReadingStates: mocks.listDocumentReadingStates,
  getAiFeatureStates: async () => ({ ai_document_reading: { available: mocks.aiFeature() } }),
}));
vi.mock('../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'traveller@example.com' }),
}));
vi.mock('../../../../../lib/providers', () => ({ createKeyManagementPort: () => undefined }));
vi.mock('../../../../../components/auto-refresh', () => ({ AutoRefresh: stub('AutoRefresh') }));
vi.mock('../document-suggestion-card', () => ({
  DocumentSuggestionCard: stub('DocumentSuggestionCard'),
}));
// The real Check What We Found (WAL2), with only its server actions stood in.
vi.mock('../actions', () => ({
  acceptClearDetailsAction: vi.fn(),
  decideClassificationProposalAction: vi.fn(),
  decideInconsistencyFlagAction: vi.fn(),
  decideProposalAction: vi.fn(),
  readAgainAction: vi.fn(),
  runClassificationAction: vi.fn(),
  runInconsistencyCheckAction: vi.fn(),
}));

const { default: WhatWeFoundPage } = await import('./page');

/**
 * WAL2 on the What We Found page: the same compact Check What We Found as the opened document
 * (rows, one at a time for Sensitive details, the accept bar), drawn by the real component.
 */

const reading = (id: string, fieldKey: string, value: string) => ({
  proposal: {
    id,
    type: 'NEW',
    fieldKey,
    value,
    confidence: 100,
    rationale: null,
    documentVersionId: 'd1-v1',
    aiExtractionRunId: 'run-1',
  },
  evidence: [{ snippet: value, verified: true }],
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getApplicant.mockResolvedValue({
    id: 'a1',
    ownerAccountId: 'acct-1',
    displayName: 'Example',
  });
  mocks.hasConsent.mockResolvedValue(true);
  mocks.requireAccess.mockResolvedValue({ ok: true, value: { proof: 'owner' } });
  mocks.aiFeature.mockReturnValue(true);
  mocks.listDocumentReadingStates.mockResolvedValue({
    ok: true,
    value: { states: new Map(), sourceOfRun: new Map() },
  });
  mocks.listDocumentsDetailed.mockResolvedValue({
    ok: true,
    value: [
      {
        id: 'd1',
        originalName: 'd1.pdf',
        approvedName: 'Passport, Example',
        latestVersionId: 'd1-v1',
      },
    ],
  });
  mocks.listPendingProposals.mockResolvedValue([
    reading('p1', 'given_name', 'Example'),
    reading('p2', 'family_name', 'Traveller'),
    reading('p3', 'passport_number', 'X0000000'),
  ]);
});

describe('the What We Found page with the WAL2 review', () => {
  it('draws compact rows, the Sensitive detail one at a time and masked, and the accept bar', async () => {
    const html = await renderServer(
      WhatWeFoundPage({ params: Promise.resolve({ id: 'a1' }), searchParams: Promise.resolve({}) }),
    );
    expect(textOf(html)).toContain('3 details, 3 clear, 0 to check');
    const rowTitles = [
      ...html.matchAll(
        /<li class="finding-row"[\s\S]*?class="expandable-section-title"[^>]*>([^<]*)</g,
      ),
    ].map((m) => m[1]);
    expect(rowTitles).toEqual(['Given Name', 'Family Name']);
    const steps = html.slice(html.indexOf('class="finding-steps"'));
    expect(steps).toContain('Passport Number');
    expect(html).toMatch(/Value Found[\s\S]*?••••••••/);
    expect(html).toMatch(/class="document-findings-bulk finding-accept-bar"/);
    expect(html).toContain('Accept 2 Clear Details');
    // Not inside an opened document, so the bar is not the phone sheet's sticky one.
    expect(html).not.toContain('wallet-selected-document');
  });
});
