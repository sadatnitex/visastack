import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer, textOf } from '../../../lib/next-mocks.test-support';

/**
 * Answering an agency request from your own record (UMPE P7): the pages, with the services as
 * stand-ins. The rules themselves are proven against a real database in the services package
 * (umpe-collection-response-service.test.ts). Synthetic values only.
 */

const mocks = vi.hoisted(() => ({
  cookie: undefined as string | undefined,
  desk: vi.fn(),
  people: vi.fn(),
  access: vi.fn(),
  propose: vi.fn(),
  own: vi.fn(),
}));

vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  openCollectionResponseDesk: mocks.desk,
  listApplicants: mocks.people,
  requireAccess: mocks.access,
  proposeCollectionResponse: mocks.propose,
  listOwnCollectionResponses: mocks.own,
}));
vi.mock('../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'traveller@example.test', self: {} }),
}));
vi.mock('../../../lib/providers', () => ({ createKeyManagementPort: () => undefined }));
vi.mock('./actions', () => ({
  submitResponseAction: async () => ({ ok: true, message: '' }),
  withdrawResponseAction: async () => ({ ok: true, message: '' }),
}));
vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) =>
      name === 'vs_collect' && mocks.cookie !== undefined ? { value: mocks.cookie } : undefined,
  }),
}));

const { default: AccountPage, metadata } = await import('./page');
const { default: AnswersPage } = await import('./answers/page');

const TOKEN = 'A'.repeat(43);
const LINK = '11111111-2222-4333-8444-555555555555';
const PERSON = '22222222-2222-4333-8444-555555555555';
const DESK = {
  linkId: LINK,
  requestId: 'req-1',
  revisionId: 'rev-1',
  revisionNo: 1,
  agency: { name: 'Synthetic Agency One', accentColor: null },
  destination: 'GB',
  purpose: 'Tourism',
  dueAt: null,
  expiresAt: new Date('2027-01-01T00:00:00Z'),
  items: [],
};
const PASSPORT = {
  id: 'item-1',
  label: 'Passport',
  kind: 'DOCUMENT',
  fieldKey: null,
  docType: 'passport',
  necessity: 'MANDATORY',
  provenance: 'OFFICIAL',
  groupKey: null,
  note: null,
  order: 0,
  source: 'r1',
  citation: 'Synthetic rule',
};
const LETTER = {
  ...PASSPORT,
  id: 'item-2',
  label: 'Employer Letter',
  docType: null,
  necessity: 'OPTIONAL',
  provenance: 'AGENCY_ADDED',
  source: 'agency',
  citation: null,
};

beforeEach(() => {
  vi.stubEnv('AGENCY_COLLECTION_REQUESTS', 'true');
  mocks.cookie = `${LINK}.${TOKEN}`;
  for (const fn of [mocks.desk, mocks.people, mocks.access, mocks.propose, mocks.own]) {
    fn.mockReset();
  }
  mocks.desk.mockResolvedValue({ ok: true, value: DESK });
  mocks.people.mockResolvedValue([{ id: PERSON, displayName: 'Synthetic Traveller' }]);
  mocks.access.mockResolvedValue({
    ok: true,
    value: { actor: { kind: 'applicant_owner' }, applicant: { id: PERSON } },
  });
  mocks.propose.mockResolvedValue({
    ok: true,
    value: {
      desk: DESK,
      person: { id: PERSON, displayName: 'Synthetic Traveller' },
      proposals: [
        {
          item: PASSPORT,
          proposedKey: 'document:v1',
          candidates: [
            {
              key: 'document:v1',
              kind: 'DOCUMENT',
              documentId: 'd1',
              documentVersionId: 'v1',
              title: 'Passport',
              versionNumber: 2,
              savedAt: new Date('2026-12-01T00:00:00Z'),
              label: 'Current Copy',
              matches: true,
            },
          ],
        },
        { item: LETTER, proposedKey: null, candidates: [] },
      ],
    },
  });
});
afterEach(() => vi.unstubAllEnvs());

describe('/collect/account', () => {
  it('is not found while the switch is off', async () => {
    vi.stubEnv('AGENCY_COLLECTION_REQUESTS', '');
    await expect(AccountPage({})).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('sends no referrer and is never indexed', () => {
    expect(metadata.referrer).toBe('no-referrer');
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it('gives one closed answer for no link, a closed link and a wrong account, and reads nothing of anyone', async () => {
    const answers: string[] = [];
    mocks.cookie = undefined;
    answers.push(textOf(await renderServer(AccountPage({}))));
    mocks.cookie = `${LINK}.${TOKEN}`;
    mocks.desk.mockResolvedValue({ ok: false, error: { code: 'not_found', message: 'closed' } });
    answers.push(textOf(await renderServer(AccountPage({}))));
    expect(new Set(answers).size).toBe(1);
    expect(answers[0]).toContain('This Link Is Not Open');
    expect(mocks.people).not.toHaveBeenCalled();
    expect(mocks.propose).not.toHaveBeenCalled();
  });

  it('asks whose record to answer from when there is more than one person, and proposes nothing yet', async () => {
    mocks.people.mockResolvedValue([
      { id: PERSON, displayName: 'Synthetic Traveller' },
      { id: 'other', displayName: 'Synthetic Child' },
    ]);
    const text = textOf(await renderServer(AccountPage({})));
    expect(text).toContain('Who Is This For?');
    expect(text).toContain('Synthetic Child');
    expect(mocks.propose).not.toHaveBeenCalled();
  });

  it('never answers for a person the gate does not give to this account as its owner', async () => {
    mocks.access.mockResolvedValue({
      ok: true,
      value: { actor: { kind: 'individual_recipient' }, applicant: { id: 'shared' } },
    });
    const text = textOf(
      await renderServer(AccountPage({ searchParams: Promise.resolve({ person: 'shared' }) })),
    );
    expect(text).toContain('Who Is This For?');
    expect(mocks.propose).not.toHaveBeenCalled();
  });

  it('shows the issued checklist with the matching current copy proposed, Still Missing where nothing matches, and the consent wording', async () => {
    const text = textOf(await renderServer(AccountPage({})));
    expect(text).toContain('Answer Synthetic Agency One');
    expect(text).toContain('Answering for Synthetic Traveller');
    expect(text).toContain('Passport');
    expect(text).toContain('Current Copy');
    expect(text).toContain('Requested by Synthetic Agency One');
    expect(text).toContain('Still Missing');
    expect(text).toContain('Nothing is shared until you submit');
    expect(text).toContain('I agree to share only the files and details I chose above');
    expect(text).toContain('Submit to Agency');
    expect(text).not.toMatch(/Reviewed|Accepted/);
  });
});

describe('/collect/account/answers', () => {
  it('lists each answer as Submitted to Agency or Withdrawn, with a way to withdraw a live one', async () => {
    mocks.own.mockResolvedValue({
      ok: true,
      value: [
        {
          id: 'resp-1',
          agencyName: 'Synthetic Agency One',
          destination: 'GB',
          revisionNo: 1,
          submittedAt: new Date('2026-12-02T00:00:00Z'),
          withdrawnAt: null,
          documents: 1,
          details: 0,
          missing: 1,
        },
        {
          id: 'resp-0',
          agencyName: 'Synthetic Agency One',
          destination: 'GB',
          revisionNo: 1,
          submittedAt: new Date('2026-12-01T00:00:00Z'),
          withdrawnAt: new Date('2026-12-02T00:00:00Z'),
          documents: 1,
          details: 0,
          missing: 1,
        },
      ],
    });
    const text = textOf(
      await renderServer(AnswersPage({ searchParams: Promise.resolve({ sent: '1' }) })),
    );
    expect(text).toContain('Submitted to Agency');
    expect(text).toContain('Withdrawn');
    expect(text).toContain('Withdraw Answer');
    expect(text).toContain('1 Still Missing');
    expect(text).not.toMatch(/Reviewed|Accepted/);
  });

  it('says plainly when there is nothing yet', async () => {
    mocks.own.mockResolvedValue({ ok: true, value: [] });
    const text = textOf(await renderServer(AnswersPage({})));
    expect(text).toContain('You have not answered any agency requests yet.');
  });
});
