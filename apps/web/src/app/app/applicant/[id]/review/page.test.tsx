import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer, stub, stubProps, textOf } from '../../../../../lib/next-mocks.test-support';

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
vi.mock('../ai-review', () => ({
  DocumentFindings: stub('DocumentFindings'),
  ReadAgainButton: stub('ReadAgainButton'),
}));

const { default: WhatWeFoundPage } = await import('./page');

const render = () => renderServer(WhatWeFoundPage({ params: Promise.resolve({ id: 'a1' }) }));

const doc = (id: string, name: string) => ({
  id,
  originalName: `${id}.pdf`,
  approvedName: name,
  latestVersionId: `${id}-v1`,
});
const reading = (id: string, versionId: string | null, fieldKey = 'given_name') => ({
  proposal: {
    id,
    type: 'NEW',
    fieldKey,
    value: 'Value',
    confidence: 100,
    rationale: null,
    documentVersionId: versionId,
    aiExtractionRunId: 'run-1',
  },
  evidence: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getApplicant.mockResolvedValue({
    id: 'a1',
    ownerAccountId: 'acct-1',
    displayName: 'Nazmus Sadat',
  });
  mocks.hasConsent.mockResolvedValue(true);
  mocks.listPendingProposals.mockResolvedValue([]);
  mocks.requireAccess.mockResolvedValue({ ok: true, value: { proof: 'owner' } });
  mocks.aiFeature.mockReturnValue(true);
  mocks.listDocumentReadingStates.mockResolvedValue({
    ok: true,
    value: { states: new Map(), sourceOfRun: new Map() },
  });
  mocks.listDocumentsDetailed.mockResolvedValue({
    ok: true,
    value: [doc('d1', 'Passport, Nazmus'), doc('d2', 'National ID, Nazmus')],
  });
});

describe('the What We Found page', () => {
  it('lists each document with what was found in it, and says how many in all', async () => {
    mocks.listPendingProposals.mockResolvedValue([
      reading('p1', 'd1-v1'),
      reading('p2', 'd1-v1', 'family_name'),
      reading('p3', 'd2-v1'),
    ]);
    const html = await render();
    const text = textOf(html);
    expect(text).toContain('What We Found');
    expect(text).toContain('3 Details found in 2 documents.');
    expect(text).toContain('Passport, Nazmus');
    expect(text).toContain('National ID, Nazmus');
    const groups = stubProps<{ proposals: unknown[]; canApprove: boolean; applicantId: string }>(
      html,
      'DocumentFindings',
    );
    expect(groups.map((group) => group.proposals.length)).toEqual([2, 1]);
    expect(groups.every((group) => group.canApprove && group.applicantId === 'a1')).toBe(true);
  });

  it('leaves out a detail an AI app suggested about the profile, and one from a document that is put away', async () => {
    mocks.listPendingProposals.mockResolvedValue([
      reading('p1', null, 'phone'),
      reading('p2', 'archived-v1'),
    ]);
    const html = await render();
    expect(stubProps(html, 'DocumentFindings')).toEqual([]);
    expect(textOf(html)).toContain('You Are Up to Date');
  });

  it('says plainly that it is up to date, and offers Add Documents, when nothing waits', async () => {
    const html = await render();
    const text = textOf(html);
    expect(text).toContain('You Are Up to Date');
    expect(text).toContain('Nothing is waiting for you.');
    expect(html).toContain('href="/app/applicant/a1/documents/add"');
  });

  it('asks for the permission first, and offers no way to accept without it', async () => {
    mocks.hasConsent.mockResolvedValue(false);
    mocks.listPendingProposals.mockResolvedValue([reading('p1', 'd1-v1')]);
    const html = await render();
    expect(textOf(html)).toContain('Let VisaStack Process My Details');
    expect(stubProps(html, 'DocumentFindings')).toEqual([]);
  });

  it("is the owner's alone", async () => {
    mocks.getApplicant.mockResolvedValue({ id: 'a1', ownerAccountId: 'someone-else' });
    await expect(render()).rejects.toThrow();
    expect(mocks.listPendingProposals).not.toHaveBeenCalled();
  });

  it('reads the profile only when there is something to compare it with', async () => {
    await render();
    expect(mocks.listApplicantProfile).not.toHaveBeenCalled();
    mocks.listPendingProposals.mockResolvedValue([reading('p1', 'd1-v1')]);
    await render();
    expect(mocks.listApplicantProfile).toHaveBeenCalledTimes(1);
  });

  describe('files that were not read', () => {
    const states = (entries: Array<[string, { stage: string; reason?: string }]>) =>
      mocks.listDocumentReadingStates.mockResolvedValue({
        ok: true,
        value: { states: new Map(entries), sourceOfRun: new Map() },
      });

    it('lists each with why, and offers to read it now, saying Read This Document for one never read', async () => {
      states([
        ['d1-v1', { stage: 'could_not_read', reason: 'PROTECTED' }],
        ['d2-v1', { stage: 'could_not_read', reason: 'NOTHING_FOUND' }],
      ]);
      const html = await render();
      const text = textOf(html);
      expect(text).toContain('Files Not Read Yet');
      expect(text).toContain('We only read this kind of document with AI when you ask.');
      expect(text).not.toContain('You Are Up to Date');
      const buttons = stubProps<{ label: string; documentVersionId: string }>(
        html,
        'ReadAgainButton',
      );
      expect(buttons).toEqual([
        expect.objectContaining({ documentVersionId: 'd1-v1', label: 'Read This Document' }),
        expect.objectContaining({ documentVersionId: 'd2-v1', label: 'Read Again' }),
      ]);
    });

    it('shows the reason but no button when asking for a reading is switched off', async () => {
      mocks.aiFeature.mockReturnValue(false);
      states([['d1-v1', { stage: 'could_not_read', reason: 'PROTECTED' }]]);
      const html = await render();
      expect(textOf(html)).toContain('Files Not Read Yet');
      expect(stubProps(html, 'ReadAgainButton')).toEqual([]);
    });

    it('lists nothing for a file that was read, is being read, or is done', async () => {
      states([
        ['d1-v1', { stage: 'found' }],
        ['d2-v1', { stage: 'done' }],
      ]);
      expect(textOf(await render())).not.toContain('Files Not Read Yet');
    });

    it('still shows the page when the reading states cannot be read', async () => {
      mocks.listDocumentReadingStates.mockRejectedValue(new Error('unavailable'));
      expect(textOf(await render())).toContain('You Are Up to Date');
    });
  });
});
