import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer, textOf } from '../../../../../lib/next-mocks.test-support';
import { expectEveryLiveMessageRendered } from '../bn-coverage.test-support';

vi.mock('@visastack/i18n', async (original) =>
  (await import('../bn-coverage.test-support')).trackBengali(await original()),
);

const current = vi.hoisted(() => ({ locale: 'en' as 'en' | 'bn', holder: null as unknown }));
// The language switch is off in the product, so the locale is set here directly.
vi.mock('../../../../../lib/locale', () => ({ getLocale: async () => current.locale }));
// Outside the server runtime React's cache remembers nothing; stand in for one request per render.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: (build: () => unknown) => () => {
    current.holder ??= build();
    return current.holder;
  },
}));

const ok = <T,>(value: T) => ({ ok: true as const, value });
const mocks = vi.hoisted(() => ({
  requireAccess: vi.fn(),
  getApplicationMemory: vi.fn(),
  listChangesSinceSnapshot: vi.fn(),
  compareSnapshotDetail: vi.fn(),
}));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  ...mocks,
}));
vi.mock('../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'synthetic-owner' }),
}));
vi.mock('../../../../../lib/providers', () => ({
  createKeyManagementPort: () => ({ synthetic: 'kms' }),
}));

const { default: MemoryPage } = await import('./page');
const { default: ThenAndNowPage } = await import('./compare/page');
const { applicantMemoryCatalog } = await import('../../../../../i18n/applicant-memory');

const bn = applicantMemoryCatalog.bn as Record<string, string>;
const en = applicantMemoryCatalog.en as Record<string, string>;
const PAGE = 'applicantMemory.appApplicantIdMemoryPage.';
const LIST = 'applicantMemory.appApplicantIdMemoryMemoryCaseList.';
const CMP = 'applicantMemory.appApplicantIdMemoryComparePage.';
const RAW_KEY = /applicantMemory\.app[A-Z]/;
const BENGALI = /[ঀ-৿]/;
/** A Bengali message with the Bengali digit for the snapshot version filled in. */
const withVersion = (message: string | undefined, digit: string) =>
  (message ?? '').replace('{version}', digit);

const SNAP = '11111111-1111-4111-8111-111111111111';
const PRIOR = '22222222-2222-4222-8222-222222222222';
const CURRENT = '33333333-3333-4333-8333-333333333333';
const AT = '2026-09-10T10:00:00.000Z';

async function memory(locale: 'en' | 'bn') {
  current.holder = null;
  current.locale = locale;
  const html = await renderServer(
    await MemoryPage({ params: Promise.resolve({ id: 'synthetic-family' }) }),
  );
  return { html, text: textOf(html) };
}

async function compare(locale: 'en' | 'bn', search: Record<string, string>) {
  current.holder = null;
  current.locale = locale;
  const html = await renderServer(
    await ThenAndNowPage({
      params: Promise.resolve({ id: 'synthetic-family' }),
      searchParams: Promise.resolve(search),
    }),
  );
  return { html, text: textOf(html) };
}

const mission = (over: Record<string, unknown> = {}) => ({
  missionId: 'case-1',
  title: 'Japan visitor visa',
  destination: null,
  purpose: null,
  agencyName: null,
  state: 'DRAFT',
  createdAt: AT,
  removed: false,
  events: [{ kind: 'prepared', id: SNAP, at: AT, snapshotId: SNAP, snapshotVersion: 1 }],
  ...over,
});

const SNAPSHOT = {
  id: SNAP,
  missionId: 'case-1',
  missionTitle: 'Japan visitor visa',
  version: 2,
  takenAt: '2026-10-18T09:00:00.000Z',
  exact: true,
};
const REVIEW = {
  confirmedAt: '2026-10-18T10:00:00.000Z',
  setAsideAt: '2026-10-20T10:00:00.000Z',
  laterConfirmation: null,
};
const side = (over: Record<string, unknown>) => ({
  factVersionId: PRIOR,
  value: null,
  effectiveFrom: null,
  recordedAt: '2026-10-01T10:00:00.000Z',
  status: 'DECLARED',
  explanation: null,
  currency: null,
  basis: null,
  ...over,
});
const detail = (over: Record<string, unknown> = {}) => ({
  snapshot: SNAPSHOT,
  review: REVIEW,
  valuesHidden: false,
  notesSaved: { prior: false, current: true },
  comparison: {
    fieldKey: 'employer_name',
    repeatingRecordKey: null,
    result: 'LEGITIMATE_CHANGE',
    label: 'Legitimate change',
    reason: 'later_effective_date',
    reasonText: 'The newer value took effect later.',
    prior: side({ value: 'Acme Ltd', effectiveFrom: '2020-01-01T00:00:00.000Z' }),
    current: side({
      factVersionId: CURRENT,
      value: 'Beta Ltd',
      effectiveFrom: '2025-03-01T00:00:00.000Z',
      explanation: 'Changed jobs in March',
    }),
  },
  ...over,
});

beforeEach(() => {
  mocks.requireAccess.mockResolvedValue(ok({ synthetic: 'proof' }));
  mocks.getApplicationMemory.mockResolvedValue(ok({ recordShares: [], cases: [mission()] }));
  mocks.listChangesSinceSnapshot.mockResolvedValue(
    ok({
      snapshot: SNAPSHOT,
      review: REVIEW,
      changes: [
        {
          kind: 'detail',
          change: 'changed',
          fieldKey: 'employer_name',
          repeatingRecordKey: null,
          factId: 'fact-1',
          priorFactVersionId: PRIOR,
          currentFactVersionId: CURRENT,
        },
      ],
      unchangedDetailCount: 4,
    }),
  );
  mocks.compareSnapshotDetail.mockResolvedValue(ok(detail()));
});
afterEach(() => {
  current.locale = 'en';
});

describe('Case History under Bengali', () => {
  it('a case with records shows the Bengali title and keeps the record lines in English', async () => {
    const { html, text } = await memory('bn');
    expect(text).toContain(bn[`${PAGE}caseHistory`]);
    expect(text).toContain('Snapshot 1 prepared');
    expect(text).toContain('Japan visitor visa');
    expect(text).not.toContain(bn[`${LIST}nothingHasBeenPreparedForThis`]);
    expect(text).not.toContain(bn[`${PAGE}noCasesYet`]);
    expect(text).not.toContain(bn[`${PAGE}openSharing`]);
    expect(html).not.toMatch(RAW_KEY);
  });

  it('a case with nothing prepared says so in Bengali', async () => {
    mocks.getApplicationMemory.mockResolvedValue(
      ok({ recordShares: [], cases: [mission({ events: [] })] }),
    );
    const { html, text } = await memory('bn');
    expect(text).toContain(bn[`${LIST}nothingHasBeenPreparedForThis`]);
    expect(text).toContain(bn[`${PAGE}caseHistory`]);
    expect(html).not.toMatch(RAW_KEY);
  });

  it('no cases says so in Bengali, with the action link left in English', async () => {
    mocks.getApplicationMemory.mockResolvedValue(ok({ recordShares: [], cases: [] }));
    const { html, text } = await memory('bn');
    expect(text).toContain(bn[`${PAGE}noCasesYet`]);
    expect(text).toContain('Open Cases');
    expect(text).toContain(bn[`${PAGE}whenYouPrepareACaseEach`]);
    expect(text).not.toContain(en[`${PAGE}whenYouPrepareACaseEach`]);
    expect(html).not.toMatch(RAW_KEY);
  });

  it('shares of the whole record show the Bengali Open Sharing link and keep the sharing wording in English', async () => {
    mocks.getApplicationMemory.mockResolvedValue(
      ok({
        recordShares: [
          {
            kind: 'shared',
            id: 'grant-1',
            at: AT,
            recipientName: 'Harbor Visas',
            recipientKind: 'organization',
            status: 'ACTIVE',
          },
        ],
        cases: [mission()],
      }),
    );
    const { html, text } = await memory('bn');
    expect(text).toContain(bn[`${PAGE}openSharing`]);
    // Bengali since the owner sign-off of 2026-11-12.
    expect(text).toContain(bn[`${PAGE}sharedOutsideACase`]);
    expect(text).toContain(bn[`${PAGE}theseSharesAreOfThisPerson`]);
    expect(`${PAGE}sharedOutsideACase` in bn).toBe(true);
    expect(html).not.toMatch(RAW_KEY);
  });

  it('is the same English as before under English, with no Bengali', async () => {
    const { text } = await memory('en');
    expect(text).not.toMatch(BENGALI);
    expect(text).toContain('Case History');
    const none = await (async () => {
      mocks.getApplicationMemory.mockResolvedValue(ok({ recordShares: [], cases: [] }));
      return memory('en');
    })();
    expect(none.text).toContain('No Cases Yet');
    expect(none.text).not.toMatch(BENGALI);
  });
});

describe('Then and Now under Bengali', () => {
  it('the list of changes shows the Bengali title and snapshot button and keeps the review wording in English', async () => {
    const { html, text } = await compare('bn', { snapshot: SNAP });
    expect(text).toContain(withVersion(bn[`${CMP}sinceSnapshotVersion`], '২'));
    expect(text).toContain(withVersion(bn[`${CMP}viewSnapshotVersion`], '২'));
    expect(text).toContain('That confirmation was set aside');
    expect(text).toContain('৪টি তথ্য এখনো এই স্ন্যাপশটে ব্যবহৃত সংস্করণেই আছে।');
    expect(text).not.toContain('4 details are still the versions this snapshot used.');
    expect(text).not.toContain(bn[`${CMP}result`]);
    expect(html).not.toMatch(RAW_KEY);
  });

  it('one detail shows both sides with Bengali row names and keeps the values, result and note in English', async () => {
    const { html, text } = await compare('bn', { snapshot: SNAP, version: PRIOR });
    expect(text).toContain(bn[`${CMP}result`]);
    expect(text).toContain(withVersion(bn[`${CMP}inSnapshotVersion`], '২'));
    expect(text).toContain(bn[`${CMP}savedOn`]);
    expect(text).toContain(bn[`${CMP}howItWasSaved`]);
    expect(text).toContain(bn[`${CMP}noteSavedWithIt`]);
    expect(text).toContain(bn[`${CMP}none`]);
    // The values, the result and the note are the person's own words or fixed vocabulary.
    expect(text).toContain('Acme Ltd');
    expect(text).toContain('Beta Ltd');
    expect(text).toContain('Legitimate change');
    expect(text).toContain('Changed jobs in March');
    expect(text).toContain(bn[`${CMP}whatToDoNext`]);
    expect(text).toContain(bn[`${CMP}thisComparesWhatWasRecordedIt`]);
    expect(text).not.toContain(en[`${CMP}thisComparesWhatWasRecordedIt`]);
    // The Compare link and its spoken name stay English together: the name holds an English
    // detail name, and a button's name and its text keep one language.
    expect(`${CMP}compare` in bn).toBe(false);
    expect(`${CMP}compareNameThenAndNow` in bn).toBe(false);
    expect(html).not.toMatch(RAW_KEY);
  });

  it('a sensitive detail with no note saved on the earlier side shows None in Bengali and keeps the hiding line in English', async () => {
    mocks.compareSnapshotDetail.mockResolvedValue(
      ok(
        detail({
          valuesHidden: true,
          notesSaved: { prior: false, current: true },
          comparison: {
            ...detail().comparison,
            fieldKey: 'passport_number',
            prior: side({ value: null }),
            current: side({ factVersionId: CURRENT, value: null, explanation: null }),
          },
        }),
      ),
    );
    const { text } = await compare('bn', { snapshot: SNAP, version: PRIOR });
    expect(text.split(bn[`${CMP}hiddenHereToKeepItPrivate`] as string)).toHaveLength(3);
    expect(text).not.toContain('Hidden here to keep it private');
    expect(text).toContain(bn[`${CMP}none`]);
    expect(text).toContain(bn[`${CMP}aNoteWasSavedHiddenHere`]);
    expect(text).not.toContain('A note was saved (hidden here to keep it private)');
    expect(text).not.toMatch(RAW_KEY);
  });

  it('an amount shows its currency and tax rows in Bengali, with the update link (refill 3)', async () => {
    mocks.compareSnapshotDetail.mockResolvedValue(
      ok(
        detail({
          comparison: {
            ...detail().comparison,
            fieldKey: 'monthly_income',
            result: 'NEEDS_CLARIFICATION',
            label: 'Needs clarification',
            prior: side({ value: '50000', currency: 'BDT', basis: null }),
            current: side({ factVersionId: CURRENT, value: '60000', currency: null }),
          },
        }),
      ),
    );
    const { html, text } = await compare('bn', { snapshot: SNAP, version: PRIOR });
    expect(text).toContain(bn[`${CMP}currency`]);
    expect(text).toContain(bn[`${CMP}beforeOrAfterTax`]);
    expect(text).toContain(bn[`${CMP}notRecorded`]);
    expect(text).toContain(bn[`${CMP}updateThisDetail`]);
    expect(text).toContain(bn[`${CMP}openTheCase`]);
    expect(text).toContain('BDT');
    expect(text).not.toContain('Update This Detail');
    expect(html).not.toMatch(RAW_KEY);
  });

  it('when one detail cannot be compared the list says so in Bengali (refill 3)', async () => {
    mocks.compareSnapshotDetail.mockResolvedValue({ ok: false, error: { code: 'unavailable' } });
    const { html, text } = await compare('bn', { snapshot: SNAP, version: PRIOR });
    expect(text).toContain(bn[`${CMP}thisComparisonCannotBeShownRight`]);
    expect(text).not.toContain(en[`${CMP}thisComparisonCannotBeShownRight`]);
    expect(html).not.toMatch(RAW_KEY);
  });

  it('a case whose files were removed says so in Bengali (refill 3)', async () => {
    mocks.getApplicationMemory.mockResolvedValue(
      ok({ recordShares: [], cases: [mission({ removed: true })] }),
    );
    const { html, text } = await memory('bn');
    expect(text).toContain(bn[`${LIST}thisCaseSFilesWereRemoved`]);
    expect(text).not.toContain(en[`${LIST}thisCaseSFilesWereRemoved`]);
    expect(html).not.toMatch(RAW_KEY);
  });

  it('an older snapshot, an unchanged snapshot and a one-detail snapshot are Bengali (signed off 2026-11-12)', async () => {
    const changesFor = (over: Record<string, unknown>) =>
      ok({ snapshot: SNAPSHOT, review: REVIEW, changes: [], unchangedDetailCount: 0, ...over });
    mocks.listChangesSinceSnapshot.mockResolvedValue(
      changesFor({ snapshot: { ...SNAPSHOT, exact: false } }),
    );
    const older = await compare('bn', { snapshot: SNAP });
    expect(older.text).toContain(bn[`${CMP}thisOlderSnapshotDidNotRecord`]);
    expect(older.text).not.toContain(en[`${CMP}thisOlderSnapshotDidNotRecord`]);

    mocks.listChangesSinceSnapshot.mockResolvedValue(changesFor({}));
    const same = await compare('bn', { snapshot: SNAP });
    expect(same.text).toContain(bn[`${CMP}nothingDiffersByVersionEveryDetail`]);

    mocks.listChangesSinceSnapshot.mockResolvedValue(changesFor({ unchangedDetailCount: 1 }));
    const one = await compare('bn', { snapshot: SNAP });
    expect(one.text).toContain(bn[`${CMP}1DetailIsStillTheVersion`]);
    expect(older.html + same.html + one.html).not.toMatch(RAW_KEY);
  });

  it('is the same English as before under English, with no Bengali', async () => {
    const list = await compare('en', { snapshot: SNAP });
    const one = await compare('en', { snapshot: SNAP, version: PRIOR });
    expect(list.text + one.text).not.toMatch(BENGALI);
    expect(list.text).toContain('Since Snapshot 2');
    expect(list.text).toContain('View Snapshot 2');
    expect(one.text).toContain('In Snapshot 2');
    expect(one.text).toContain('Note Saved with It');
  });
});

describe('Bengali coverage of the case history surface', () => {
  it('every live Bengali message was rendered by a test above', () => {
    expectEveryLiveMessageRendered(applicantMemoryCatalog);
  });
});
