import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  renderServer,
  stub,
  stubProps,
  textOf,
} from '../../../../../../lib/next-mocks.test-support';

const mocks = vi.hoisted(() => ({
  getApplicant: vi.fn(),
  hasConsent: vi.fn(),
  loadUploadQuotaConfig: vi.fn(),
  familyBatchReady: vi.fn(async () => false),
  documentUploadReceiptsReady: vi.fn(async () => true),
  listPendingProposals: vi.fn(async (): Promise<unknown[]> => []),
  listApplicants: vi.fn(async (): Promise<unknown[]> => []),
  getAiFeatureStates: vi.fn(
    async (): Promise<unknown> => ({
      ai_automatic_reading: {
        feature: 'ai_automatic_reading',
        available: true,
        reason: null,
        dailyLimit: null,
      },
    }),
  ),
  listDocumentExceptions: vi.fn(async () => ({ exceptions: [] as unknown[], confirmed: [] })),
  malwareScanning: { value: 'unconfigured' as 'unconfigured' | 'available' },
}));

vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  getApplicant: mocks.getApplicant,
  hasConsent: mocks.hasConsent,
  loadUploadQuotaConfig: mocks.loadUploadQuotaConfig,
  getApplicantEvidenceBytes: async () => 0,
  storageLimitsForOwner: async (
    _db: unknown,
    _owner: string,
    config: { maxApplicantEvidenceBytes: number },
  ) => ({ personBytes: config.maxApplicantEvidenceBytes }),
  requireAccess: async () => ({ ok: true, value: { proof: 'owner' } }),
  familyBatchReady: mocks.familyBatchReady,
  documentUploadReceiptsReady: mocks.documentUploadReceiptsReady,
  listPendingProposals: mocks.listPendingProposals,
  listApplicants: mocks.listApplicants,
  getAiFeatureStates: mocks.getAiFeatureStates,
  listDocumentExceptions: mocks.listDocumentExceptions,
}));
vi.mock('../../../../../../lib/capabilities', () => ({
  resolvePlatformCapabilities: async () => ({ malwareScanning: mocks.malwareScanning.value }),
}));
vi.mock('../../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'traveller@example.com' }),
}));
vi.mock('../../document-uploader', () => ({ DocumentUploader: stub('DocumentUploader') }));
vi.mock('../../import/import-panel', () => ({ ImportPanel: stub('ImportPanel') }));
vi.mock('../../usage-meter', () => ({ UsageMeter: stub('UsageMeter') }));
vi.mock('./reading-switch', () => ({ ReadingSwitch: stub('ReadingSwitch') }));

const { default: AddDocumentsPage } = await import('./page');

const render = (search: { type?: string } = {}) =>
  renderServer(
    AddDocumentsPage({
      params: Promise.resolve({ id: 'a1' }),
      searchParams: Promise.resolve(search),
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.malwareScanning.value = 'unconfigured';
  mocks.getApplicant.mockResolvedValue({
    id: 'a1',
    ownerAccountId: 'acct-1',
    displayName: 'Karim Hossain',
  });
  mocks.hasConsent.mockResolvedValue(true);
  mocks.familyBatchReady.mockResolvedValue(false);
  mocks.documentUploadReceiptsReady.mockResolvedValue(true);
  mocks.listPendingProposals.mockResolvedValue([]);
  mocks.listApplicants.mockResolvedValue([]);
  mocks.getAiFeatureStates.mockResolvedValue({
    ai_automatic_reading: {
      feature: 'ai_automatic_reading',
      available: true,
      reason: null,
      dailyLimit: null,
    },
  });
  mocks.listDocumentExceptions.mockResolvedValue({ exceptions: [], confirmed: [] });
  mocks.loadUploadQuotaConfig.mockReturnValue({
    maxUploadBytes: 5 * 1024 * 1024,
    maxApplicantEvidenceBytes: 50 * 1024 * 1024,
  });
});

describe('the Add Documents page', () => {
  it('shows one drop area first, with the camera and kind choice behind one quiet line', async () => {
    const html = await render();
    expect(textOf(html)).toContain('Add Documents');
    expect(stubProps(html, 'ImportPanel')).toHaveLength(1);
    expect(html).toMatch(/<details class="add-more"(?![^>]*\sopen)/);
    expect(textOf(html)).toContain('Take a Photo, or Say What Kind of Document It Is');
    expect(stubProps(html, 'DocumentUploader')).toHaveLength(1);
  });

  it("hands the import this account's people, this person first, so each file can be filed under who it is for", async () => {
    mocks.listApplicants.mockResolvedValue([
      { id: 'a2', displayName: 'Sara Hossain' },
      { id: 'a1', displayName: 'Karim Hossain' },
      { id: 'a3', displayName: 'Nila Hossain' },
    ]);
    const [props] = stubProps<{ people: { id: string; name: string }[] }>(
      await render(),
      'ImportPanel',
    );
    expect(props?.people).toEqual([
      { id: 'a1', name: 'Karim Hossain' },
      { id: 'a2', name: 'Sara Hossain' },
      { id: 'a3', name: 'Nila Hossain' },
    ]);
  });

  it('still shows the page, with no choice of people, when the list cannot be read', async () => {
    mocks.listApplicants.mockRejectedValue(new Error('database unavailable'));
    const [props] = stubProps<{ people: unknown[] }>(await render(), 'ImportPanel');
    expect(props?.people).toEqual([]);
  });

  const switchView = async () => {
    const [props] = stubProps<{
      view: { status: string; reads: boolean; canChange: boolean };
    }>(await render(), 'ReadingSwitch');
    return props?.view;
  };

  it('says automatic reading is on only when it can run and the person allowed both kinds', async () => {
    expect(await switchView()).toMatchObject({ status: 'on', reads: true, canChange: true });
  });

  it('says it is off for the person, with their own switch, when they have not allowed it', async () => {
    mocks.hasConsent.mockImplementation(
      async (_db: unknown, _id: string, type: string) => type === 'CORE_PROCESSING',
    );
    expect(await switchView()).toMatchObject({
      status: 'needs_consent',
      reads: false,
      canChange: true,
    });
  });

  it('says it is off, with no switch, when the platform switch is off, even if the person allowed it', async () => {
    mocks.getAiFeatureStates.mockResolvedValue({
      ai_automatic_reading: {
        feature: 'ai_automatic_reading',
        available: false,
        reason: 'turned_off',
        dailyLimit: null,
      },
    });
    expect(await switchView()).toMatchObject({ status: 'off', reads: false, canChange: false });
    const text = textOf(await render());
    expect(text).toContain('We check each one and keep it for you.');
    expect(text).toContain('You Add the Details');
    expect(text).not.toContain('Read for Details');
    const [panel] = stubProps<{ readingOn: boolean }>(await render(), 'ImportPanel');
    expect(panel?.readingOn).toBe(false);
  });

  it('says it is off, never on, when its state cannot be read', async () => {
    mocks.getAiFeatureStates.mockRejectedValue(new Error('database unavailable'));
    expect(await switchView()).toMatchObject({ status: 'off', reads: false, canChange: false });
  });

  it('says what happens next in three plain steps', async () => {
    const text = textOf(await render());
    for (const step of ['Format Checked', 'Read for Details', 'You Approve']) {
      expect(text).toContain(step);
    }
    // A way out to the result: the uploader saves a file and this page has no list of its own.
    expect(await render()).toContain('href="/app/applicant/a1/documents"');
  });

  // The old page said "Every file is scanned before anyone can open it" whatever the platform did.
  const MISLEADING = [
    'Every file is scanned',
    'Checked for Safety',
    'scanned before anyone can open it',
    'check each one for safety',
  ];

  it('never says a file is virus scanned while virus scanning is not switched on', async () => {
    const html = await render();
    const text = textOf(html);
    for (const sentence of MISLEADING) expect(text, sentence).not.toContain(sentence);
    expect(text).toContain('Virus scanning is not switched on yet.');
    expect(text).toContain('which is not a virus scan');
    expect(text).not.toContain('Checked for Viruses');
    const [uploader] = stubProps<{ virusScanning: boolean }>(html, 'DocumentUploader');
    expect(uploader?.virusScanning).toBe(false);
  });

  it('says new files are virus scanned only when the platform check says the scanner is running', async () => {
    mocks.malwareScanning.value = 'available';
    const html = await render();
    const text = textOf(html);
    expect(text).toContain('Checked for Viruses');
    expect(text).toContain('cannot be opened until the scan finishes');
    expect(text).not.toContain('Virus scanning is not switched on yet.');
    for (const sentence of MISLEADING) expect(text, sentence).not.toContain(sentence);
    const [uploader] = stubProps<{ virusScanning: boolean }>(html, 'DocumentUploader');
    expect(uploader?.virusScanning).toBe(true);
  });

  it('is told the limit the server really enforces, not a number written into the page', async () => {
    // A 5 MB quota is capped at what one request to the host can carry (4 MB).
    const [uploader] = stubProps<{ applicantId: string }>(await render(), 'DocumentUploader');
    expect(uploader).toMatchObject({
      applicantId: 'a1',
      limitBytes: 4 * 1024 * 1024,
      limitLabel: '4 MB',
      pdfAccepted: true,
      virusScanning: false,
    });
    const [panel] = stubProps<{ limitLabel: string }>(await render(), 'ImportPanel');
    expect(panel).toMatchObject({ limitLabel: '4 MB', retryUnknown: true, familyBatch: false });

    mocks.loadUploadQuotaConfig.mockReturnValue({
      maxUploadBytes: 2 * 1024 * 1024,
      maxApplicantEvidenceBytes: 50 * 1024 * 1024,
    });
    const [tight] = stubProps<{ limitLabel: string }>(await render(), 'DocumentUploader');
    expect(tight).toMatchObject({ limitBytes: 2 * 1024 * 1024, limitLabel: '2 MB' });
  });

  it('offers PDF on the built-in checks, and stops offering it when the owner switches PDF uploads off', async () => {
    try {
      const [on] = stubProps<{ pdfAccepted: boolean }>(await render(), 'DocumentUploader');
      expect(on?.pdfAccepted).toBe(true);
      vi.stubEnv('PDF_UPLOADS', 'off');
      const [off] = stubProps<{ pdfAccepted: boolean }>(await render(), 'DocumentUploader');
      expect(off?.pdfAccepted).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('offers every catalogue kind of document, so a file can be filed under its category', async () => {
    const [uploader] = stubProps<{ kindGroups: { choices: { key: string }[] }[] }>(
      await render(),
      'DocumentUploader',
    );
    const keys = (uploader?.kindGroups ?? []).flatMap((g) => g.choices.map((c) => c.key));
    expect(keys).toContain('PASSPORT');
    expect(keys).toContain('OTHER');
  });

  it('opens the kind choice ready for a kind the catalogue knows, and ignores anything else', async () => {
    const known = await render({ type: 'passport' });
    expect(known).toMatch(/<details class="add-more"[^>]*\sopen/);
    const [uploader] = stubProps<{ initialKind: string }>(known, 'DocumentUploader');
    expect(uploader?.initialKind).not.toBe('');
    const unknown = await render({ type: 'not-a-kind' });
    expect(unknown).not.toMatch(/<details class="add-more"[^>]*\sopen/);
    expect(stubProps<{ initialKind: string }>(unknown, 'DocumentUploader')[0]?.initialKind).toBe(
      '',
    );
  });

  it('is not shown until core processing consent is granted, and the existing documents stay out of it', async () => {
    mocks.hasConsent.mockResolvedValue(false);
    const html = await render();
    expect(stubProps(html, 'ImportPanel')).toEqual([]);
    expect(stubProps(html, 'DocumentUploader')).toEqual([]);
    expect(textOf(html)).toContain('Let VisaStack Process My Details');
  });

  it("is not the owner's to open for someone else's traveller", async () => {
    mocks.getApplicant.mockResolvedValue({ id: 'a1', ownerAccountId: 'someone-else' });
    await expect(render()).rejects.toThrow();
  });

  it('shows no results card until something was found', async () => {
    const text = textOf(await render());
    expect(text).not.toContain('We Found');
    expect(text).not.toContain('One Answer');
  });

  it("says how many details were found and offers the one next step, ignoring an app's suggestion about the profile", async () => {
    mocks.listPendingProposals.mockResolvedValue([
      { proposal: { documentVersionId: 'v1' } },
      { proposal: { documentVersionId: 'v1' } },
      { proposal: { documentVersionId: 'v2' } },
      { proposal: { documentVersionId: null } },
    ]);
    const html = await render();
    expect(textOf(html)).toContain('We Found 3 Details to Check');
    expect(textOf(html)).toContain('Review 3 Details');
    expect(html).toContain('href="/app/applicant/a1/documents"');
    expect(html).toContain('Nothing reaches your profile until you do.');
  });

  it('says it plainly for one detail, and names the files that need one answer', async () => {
    mocks.listPendingProposals.mockResolvedValue([{ proposal: { documentVersionId: 'v1' } }]);
    mocks.listDocumentExceptions.mockResolvedValue({
      // Three rows but two files: one file has both a relation suggestion and an intake finding.
      exceptions: [{ documentId: 'd1' }, { documentId: 'd1' }, { documentId: 'd2' }],
      confirmed: [],
    });
    const html = await render();
    expect(textOf(html)).toContain('We Found 1 Detail to Check');
    expect(textOf(html)).toContain('2 Files Need One Answer');
    expect(html).toContain('documents#needs-decision');
  });

  it('still shows the page when the results cannot be read', async () => {
    mocks.listPendingProposals.mockRejectedValue(new Error('down'));
    mocks.listDocumentExceptions.mockRejectedValue(new Error('down'));
    const html = await render();
    expect(textOf(html)).not.toContain('We Found');
    expect(stubProps(html, 'ImportPanel')).toHaveLength(1);
  });

  it('shows no results card without core processing consent', async () => {
    mocks.hasConsent.mockResolvedValue(false);
    mocks.listPendingProposals.mockResolvedValue([{ proposal: { documentVersionId: 'v1' } }]);
    expect(textOf(await render())).not.toContain('We Found');
    expect(mocks.listPendingProposals).not.toHaveBeenCalled();
  });

  it("hands the next step to its own card by turning the panel's two buttons off", async () => {
    const [panel] = stubProps<{ showNext: boolean }>(await render(), 'ImportPanel');
    expect(panel?.showNext).toBe(false);
  });
});
