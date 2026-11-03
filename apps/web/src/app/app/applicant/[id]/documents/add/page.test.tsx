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
}));
vi.mock('../../../../../../lib/capabilities', () => ({
  resolvePlatformCapabilities: async () => ({ malwareScanning: 'unavailable' }),
}));
vi.mock('../../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'traveller@example.com' }),
}));
vi.mock('../../document-uploader', () => ({ DocumentUploader: stub('DocumentUploader') }));
vi.mock('../../import/import-panel', () => ({ ImportPanel: stub('ImportPanel') }));
vi.mock('../../usage-meter', () => ({ UsageMeter: stub('UsageMeter') }));

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
  mocks.getApplicant.mockResolvedValue({
    id: 'a1',
    ownerAccountId: 'acct-1',
    displayName: 'Karim Hossain',
  });
  mocks.hasConsent.mockResolvedValue(true);
  mocks.familyBatchReady.mockResolvedValue(false);
  mocks.documentUploadReceiptsReady.mockResolvedValue(true);
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

  it('says what happens next in three plain steps', async () => {
    const text = textOf(await render());
    for (const step of ['Checked for Safety', 'Read for Details', 'You Approve']) {
      expect(text).toContain(step);
    }
    // A way out to the result: the uploader saves a file and this page has no list of its own.
    expect(await render()).toContain('href="/app/applicant/a1/documents"');
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
});
