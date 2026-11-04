import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadOrgAccess: vi.fn(),
  loadEvidenceRequestPage: vi.fn(),
  requireAccess: vi.fn(),
  listEvidenceSubmissions: vi.fn(),
  downloadEvidenceSubmissionFile: vi.fn(),
  establishStepUpProof: vi.fn(),
  createStorage: vi.fn(),
  reportServerError: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock('@visastack/services', () => ({
  EACH_GRANT: 'each-grant',
  accountPrincipal: (accountId: string) => ({ kind: 'account', accountId }),
  isUuid: (value: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value),
  requireAccess: mocks.requireAccess,
  listEvidenceSubmissions: mocks.listEvidenceSubmissions,
  downloadEvidenceSubmissionFile: mocks.downloadEvidenceSubmissionFile,
}));
vi.mock('./console-data', () => ({
  loadOrgAccess: mocks.loadOrgAccess,
  loadEvidenceRequestPage: mocks.loadEvidenceRequestPage,
}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    mocks.redirect(to);
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
}));
vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: { tag: 'db' }, accountId: 'admin-1' }),
}));
vi.mock('../../../../lib/step-up', () => ({ establishStepUpProof: mocks.establishStepUpProof }));
vi.mock('../../../../lib/storage', () => ({ createStorage: mocks.createStorage }));
vi.mock('../../../../lib/server-error', () => ({ reportServerError: mocks.reportServerError }));

const { downloadEvidenceCopyAction } = await import('./evidence-copy-actions');

const ORG = '11111111-1111-4111-8111-111111111111';
const REQUEST = '22222222-2222-4222-8222-222222222222';
const SUBMISSION = '33333333-3333-4333-8333-333333333333';
const VERSION = '44444444-4444-4444-8444-444444444444';
const APPLICANT = '55555555-5555-4555-8555-555555555555';
const MISSION = '66666666-6666-4666-8666-666666666666';

const SECRET_NAME = 'BLOB_SIGNING_SECRET';
const PAGE = `/app/agency/${ORG}/clients?request=${REQUEST}#request-${REQUEST}`;
const BACK = `/app/agency/${ORG}/clients?request=${REQUEST}&file=unavailable#request-${REQUEST}`;

const form = (over: Record<string, string> = {}) => {
  const data = new FormData();
  const fields = { organizationId: ORG, requestId: REQUEST, submissionId: SUBMISSION, ...over };
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

/** Runs the action and returns where it sent the person. */
async function run(data: FormData = form()): Promise<string> {
  await expect(downloadEvidenceCopyAction(data)).rejects.toThrow('NEXT_REDIRECT');
  return String(mocks.redirect.mock.calls.at(-1)?.[0]);
}

beforeEach(() => {
  vi.resetAllMocks();
  process.env[SECRET_NAME] = 'test-signing-secret-of-some-length';
  mocks.loadOrgAccess.mockResolvedValue({ org: {}, admin: true, member: true });
  mocks.loadEvidenceRequestPage.mockResolvedValue({
    items: [{ id: REQUEST, kind: 'DOCUMENT', applicantId: APPLICANT, missionId: MISSION }],
  });
  mocks.requireAccess.mockResolvedValue({ ok: true, value: { proof: 'manage' } });
  mocks.listEvidenceSubmissions.mockResolvedValue({
    ok: true,
    value: {
      available: true,
      submissions: [{ id: SUBMISSION, documentVersionId: VERSION, fileAvailable: true }],
      legacy: [],
    },
  });
  mocks.establishStepUpProof.mockResolvedValue({ kind: 'proof', proof: { step: 'up' } });
  mocks.createStorage.mockReturnValue({ storage: true });
  mocks.downloadEvidenceSubmissionFile.mockResolvedValue({
    ok: true,
    value: { url: 'https://store.example/api/blob/abc?token=t1&x=2' },
  });
});

describe('Download Sent File', () => {
  it('goes to this deployment authorization route, and only there', async () => {
    expect(await run()).toBe('/api/blob/abc?token=t1&x=2');
  });

  it('reads the request again as this organization own, with its own MANAGE proof', async () => {
    await run();
    expect(mocks.loadEvidenceRequestPage).toHaveBeenCalledWith(
      { tag: 'db' },
      'admin-1',
      ORG,
      { org: {}, admin: true, member: true },
      { limit: 1, only: REQUEST },
    );
    expect(mocks.requireAccess).toHaveBeenCalledWith(
      { tag: 'db' },
      { kind: 'account', accountId: 'admin-1' },
      'MANAGE',
      { missionId: MISSION },
      { purpose: 'each-grant', actingFor: { organizationId: ORG } },
    );
  });

  it('uses the traveller scope when the request has no case', async () => {
    mocks.loadEvidenceRequestPage.mockResolvedValue({
      items: [{ id: REQUEST, kind: 'DOCUMENT', applicantId: APPLICANT, missionId: null }],
    });
    await run();
    expect(mocks.requireAccess.mock.calls[0]?.[3]).toEqual({ applicantId: APPLICANT });
  });

  it('asks for the identity check on the version found on the request, never one the page named', async () => {
    await run(form({ documentVersionId: '77777777-7777-4777-8777-777777777777' }));
    expect(mocks.establishStepUpProof).toHaveBeenCalledWith(
      { accountId: 'admin-1', action: 'DOWNLOAD_ORIGINAL', resourceId: VERSION },
      PAGE,
    );
    expect(mocks.downloadEvidenceSubmissionFile).toHaveBeenCalledWith(
      { storage: true },
      { proof: 'manage' },
      {
        submissionId: SUBMISSION,
        accessTokenSecret: 'test-signing-secret-of-some-length',
        stepUp: { step: 'up' },
      },
    );
    // Nothing from the page can name a file version: the call has no such field.
    expect(JSON.stringify(mocks.downloadEvidenceSubmissionFile.mock.calls)).not.toContain(
      '77777777',
    );
  });

  it('sends the person to confirm it is them when the sign-in is not recent, and downloads nothing', async () => {
    mocks.establishStepUpProof.mockResolvedValue({
      kind: 'reauth_required',
      reauthUrl: '/auth/recheck?back=x',
    });
    expect(await run()).toBe('/auth/recheck?back=x');
    expect(mocks.downloadEvidenceSubmissionFile).not.toHaveBeenCalled();
  });

  it('refuses an address that is not under /api/blob/, with the one back address', async () => {
    mocks.downloadEvidenceSubmissionFile.mockResolvedValue({
      ok: true,
      value: { url: 'https://store.example/private/file?sig=abc' },
    });
    expect(await run()).toBe(BACK);
    mocks.downloadEvidenceSubmissionFile.mockResolvedValue({
      ok: true,
      value: { url: 'https://evil.example/api/blob-evil/x' },
    });
    expect(await run()).toBe(BACK);
  });
});

describe('every refusal looks the same', () => {
  const refusals: Array<[string, () => void]> = [
    [
      'a member who is not an administrator',
      () => mocks.loadOrgAccess.mockResolvedValue({ org: {}, admin: false, member: true }),
    ],
    ['no such organization', () => mocks.loadOrgAccess.mockResolvedValue(null)],
    [
      'a request that is not on this organization',
      () => mocks.loadEvidenceRequestPage.mockResolvedValue({ items: [] }),
    ],
    [
      'a different request than the one asked for',
      () =>
        mocks.loadEvidenceRequestPage.mockResolvedValue({
          items: [
            {
              id: '99999999-9999-4999-8999-999999999999',
              kind: 'DOCUMENT',
              applicantId: APPLICANT,
              missionId: null,
            },
          ],
        }),
    ],
    [
      'a detail request',
      () =>
        mocks.loadEvidenceRequestPage.mockResolvedValue({
          items: [{ id: REQUEST, kind: 'FIELD', applicantId: APPLICANT, missionId: null }],
        }),
    ],
    ['a lost grant', () => mocks.requireAccess.mockResolvedValue({ ok: false, error: {} })],
    [
      'a list that cannot be read',
      () => mocks.listEvidenceSubmissions.mockResolvedValue({ ok: false, error: {} }),
    ],
    [
      'a copy that is not on the request',
      () =>
        mocks.listEvidenceSubmissions.mockResolvedValue({
          ok: true,
          value: { available: true, submissions: [], legacy: [] },
        }),
    ],
    [
      'a copy the service does not offer',
      () =>
        mocks.listEvidenceSubmissions.mockResolvedValue({
          ok: true,
          value: {
            available: true,
            submissions: [{ id: SUBMISSION, documentVersionId: VERSION, fileAvailable: false }],
            legacy: [],
          },
        }),
    ],
    [
      'exact copies not kept yet',
      () =>
        mocks.listEvidenceSubmissions.mockResolvedValue({
          ok: true,
          value: { available: false, submissions: [], legacy: [] },
        }),
    ],
    [
      'an identity check that cannot be made',
      () => mocks.establishStepUpProof.mockResolvedValue({ kind: 'unavailable' }),
    ],
    [
      'the service refusing the download',
      () =>
        mocks.downloadEvidenceSubmissionFile.mockResolvedValue({
          ok: false,
          error: { code: 'forbidden' },
        }),
    ],
    [
      'an unexpected failure',
      () => mocks.requireAccess.mockRejectedValue(new Error('database exploded with ids')),
    ],
  ];

  it.each(refusals)('lands on the same page, with no reason, for %s', async (_name, arrange) => {
    arrange();
    expect(await run()).toBe(BACK);
    // Whatever failed, no address was ever returned to the browser except the back page.
    expect(mocks.redirect).toHaveBeenLastCalledWith(BACK);
  });

  it('asks the service for a file only after every check on this side passed', async () => {
    for (const [name, arrange] of refusals) {
      if (name === 'the service refusing the download') continue;
      vi.clearAllMocks();
      mocks.createStorage.mockReturnValue({ storage: true });
      mocks.loadOrgAccess.mockResolvedValue({ org: {}, admin: true, member: true });
      mocks.loadEvidenceRequestPage.mockResolvedValue({
        items: [{ id: REQUEST, kind: 'DOCUMENT', applicantId: APPLICANT, missionId: MISSION }],
      });
      mocks.requireAccess.mockResolvedValue({ ok: true, value: { proof: 'manage' } });
      mocks.listEvidenceSubmissions.mockResolvedValue({
        ok: true,
        value: {
          available: true,
          submissions: [{ id: SUBMISSION, documentVersionId: VERSION, fileAvailable: true }],
          legacy: [],
        },
      });
      mocks.establishStepUpProof.mockResolvedValue({ kind: 'proof', proof: { step: 'up' } });
      arrange();
      await run();
      expect(mocks.downloadEvidenceSubmissionFile, name).not.toHaveBeenCalled();
    }
  });

  it('is the same address when the signing secret is missing', async () => {
    Reflect.deleteProperty(process.env, SECRET_NAME);
    expect(await run()).toBe(BACK);
    expect(mocks.loadOrgAccess).not.toHaveBeenCalled();
  });

  it('reads nothing and goes to the app home for ids that are not ids', async () => {
    expect(await run(form({ submissionId: 'not-an-id' }))).toBe('/app');
    expect(await run(form({ organizationId: '../x' }))).toBe('/app');
    expect(mocks.loadOrgAccess).not.toHaveBeenCalled();
  });

  it('reports an unexpected failure without any id or address in it', async () => {
    mocks.requireAccess.mockRejectedValue(new Error('boom'));
    await run();
    expect(mocks.reportServerError).toHaveBeenCalledTimes(1);
    const [where, , extra] = mocks.reportServerError.mock.calls[0] ?? [];
    expect(where).toBe('evidenceCopyDownload');
    expect(JSON.stringify(extra)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
    expect(JSON.stringify(mocks.reportServerError.mock.calls)).not.toContain('/api/blob');
  });
});
