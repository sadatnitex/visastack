import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
// The language switch is off in the product, so the locale is set here directly.
const current = vi.hoisted(() => ({ locale: 'en' as 'en' | 'bn', holder: null as unknown }));
vi.mock('../../../../lib/locale', () => ({ getLocale: async () => current.locale }));
// Outside the server runtime React's cache remembers nothing; stand in for one request per render.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: (build: () => unknown) => () => {
    current.holder ??= build();
    return current.holder;
  },
}));

const service = vi.hoisted(() => ({
  getApplicant: vi.fn(),
  listDocumentsDetailed: vi.fn(),
  getReminderThresholds: vi.fn(),
  listIssuerVerificationsForDocument: vi.fn(),
  listMissions: vi.fn(),
  getEvidenceCandidates: vi.fn(),
  accountPrincipal: vi.fn(),
  requireAccess: vi.fn(),
  listDeadlineClock: vi.fn(),
  listApplicantProfile: vi.fn(),
  listMissionsUsingField: vi.fn(),
}));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  ...service,
}));
vi.mock('../../../../lib/ccd/depth.server', () => ({ readDepth: async () => 'auto' }));
vi.mock('../../../../lib/session', () => ({
  withSession: (callback: (ctx: unknown) => unknown) => callback({ db: {}, accountId: 'owner' }),
}));
vi.mock('./actions', () => ({
  setDocumentExpiryAction: vi.fn(),
  renameDocumentAction: vi.fn(),
  setDocumentTypeAction: vi.fn(),
}));

import { I18nProvider } from '../../../../components/i18n-provider';
import { appApplicantCatalog } from '../../../../i18n/app-applicant';
import { formatTimestampDate } from '../../../../lib/format-date';
import { primeLocale } from '../../../../lib/i18n-server';
import { navigationState, renderServer, textOf } from '../../../../lib/next-mocks.test-support';
import { DocumentExpiryForm } from './document-expiry-form';
import { DocumentRenameForm } from './document-rename-form';
import { DocumentTypeForm } from './document-type-form';
import { default as ExpiryPage } from './expiry/page';
import { default as HistoryPage } from './history/page';
import { RecordBrowser } from './record-browser';
import type { RecordItem } from './record-hub';
import { RecordSections } from './record-sections';
import { FlowSteps } from './review/flow-steps';

const BENGALI = /[ঀ-৿]/;
const bn = appApplicantCatalog.bn as Record<string, string>;
const en = appApplicantCatalog.en as Record<string, string>;
const K = 'appApplicant.appApplicantId';

/** A client component under a locale, the way the root layout wraps every page. */
const client = (locale: 'en' | 'bn', node: React.ReactElement) =>
  textOf(
    renderToStaticMarkup(
      <I18nProvider locale={locale} pageLang={locale}>
        {node}
      </I18nProvider>,
    ),
  );

/** A server component under a locale, with the locale read once as a page does. */
async function server(locale: 'en' | 'bn', build: () => unknown | Promise<unknown>) {
  current.holder = null;
  current.locale = locale;
  await primeLocale();
  return textOf(await renderServer(Promise.resolve(build()) as never));
}

const item = (id: string): RecordItem => ({
  id,
  kind: 'document',
  group: 'Identity',
  title: `Document ${id}`,
  type: null,
  status: { label: 'Current', tone: 'success' },
  usable: true,
  needsAttention: false,
  previousVersion: false,
  empty: false,
  facts: [],
  href: `/app/applicant/p1/documents/${id}`,
  action: null,
  searchText: id,
});

beforeEach(() => {
  vi.resetAllMocks();
  service.getApplicant.mockResolvedValue({ id: 'person', ownerAccountId: 'owner' });
  service.listDocumentsDetailed.mockResolvedValue({ ok: true, value: [] });
  service.getReminderThresholds.mockResolvedValue([90, 60, 30, 7, 0]);
  service.listIssuerVerificationsForDocument.mockResolvedValue([]);
  service.listMissions.mockResolvedValue({ ok: true, value: [] });
  service.getEvidenceCandidates.mockResolvedValue({ ok: true, value: [] });
  service.accountPrincipal.mockReturnValue({ kind: 'account', accountId: 'owner' });
  service.requireAccess.mockResolvedValue({
    ok: true,
    value: { actor: { kind: 'applicant_owner' }, applicantId: 'person' },
  });
  service.listDeadlineClock.mockResolvedValue({
    ok: true,
    value: { applicantId: 'person', entries: [] },
  });
  service.listApplicantProfile.mockResolvedValue({
    ok: true,
    value: { total: 0, nextCursor: null, items: [] },
  });
  service.listMissionsUsingField.mockResolvedValue({ ok: true, value: [] });
});
afterEach(() => {
  current.locale = 'en';
  navigationState.pathname = '/';
});

describe('the record tabs and list under Bengali', () => {
  it('shows the Bengali tab label only on a record page', () => {
    navigationState.pathname = '/app/applicant/p1/record';
    const html = renderToStaticMarkup(
      <I18nProvider locale="bn" pageLang="bn">
        <RecordSections applicantId="p1" />
      </I18nProvider>,
    );
    expect(html).toContain(`aria-label="${bn[`${K}RecordSections.recordSections`]}"`);
    navigationState.pathname = '/app/account';
    expect(client('bn', <RecordSections applicantId="p1" />)).toBe('');
  });

  it('counts the matching items in Bengali digits, for one, many and none', () => {
    const many = client('bn', <RecordBrowser items={[item('a'), item('b'), item('c')]} />);
    expect(many).toContain('৩টি আইটেম মিলেছে।');
    expect(many).not.toContain('3 items match');
    const none = client('bn', <RecordBrowser items={[]} />);
    expect(none).toContain('০টি আইটেম মিলেছে।');
    const one = client('bn', <RecordBrowser items={[item('a')]} />);
    expect(one).not.toContain('১টি আইটেম মিলেছে।');
    expect(one).toContain(en[`${K}RecordBrowser.1ItemMatches`] ?? 'MISSING');
    expect(many).toContain(bn[`${K}RecordBrowser.recordFilters`]);
  });
});

describe('the document forms under Bengali', () => {
  const base = {
    applicantId: 'p1',
    documentId: 'd1',
    typedOn: null,
    mismatch: false,
    savedLabel: null,
    typedLabel: null,
  };

  it('says where an expiry date came from in each of its states', () => {
    const read = client(
      'bn',
      <DocumentExpiryForm {...base} origin="READ" savedLabel="১২ নভেম্বর ২০২৭" />,
    );
    // Held back: it says automatic reading found the date, so it stays English with the date in Bengali digits.
    expect(read).toContain('১২ নভেম্বর ২০২৭, read from the document.');
    expect(read).toContain(bn[`${K}DocumentExpiryForm.expiryDate`]);
    // States with no Bengali yet fall back to English, never to a raw key.
    for (const props of [
      { origin: 'TYPED' as const, savedLabel: '12 Nov 2027' },
      { origin: 'NONE' as const },
      { origin: 'READ' as const, mismatch: true, savedLabel: 'a', typedLabel: 'b' },
    ]) {
      const text = client('bn', <DocumentExpiryForm {...base} {...props} />);
      expect(text).not.toMatch(/appApplicant\.|\{[A-Za-z]+\}/);
      expect(text).toContain(bn[`${K}DocumentExpiryForm.expiryDate`]);
    }
  });

  it('renames a document and sets its kind in Bengali', () => {
    expect(
      client('bn', <DocumentRenameForm applicantId="p1" documentId="d1" name="Passport" />),
    ).toContain(bn[`${K}DocumentRenameForm.documentName`]);
  });

  it('draws the kind picker in Bengali with the names unchanged', async () => {
    const text = await server('bn', () => (
      <DocumentTypeForm
        applicantId="p1"
        documentId="d1"
        docType={null}
        subject={null}
        groups={
          [
            {
              key: 'identity',
              label: 'Identity',
              choices: [{ key: 'PASSPORT', label: 'Passport' }],
            },
          ] as never
        }
      />
    ));
    expect(text).toContain(bn[`${K}DocumentTypeForm.save`]);
    expect(text).toContain('Passport');
  });
});

describe('the review steps under Bengali', () => {
  it('shows every step state, in English where no Bengali is ready, never as a raw key', async () => {
    for (const state of ['add', 'check', 'review', 'done'] as const) {
      const text = await server('bn', () => <FlowSteps current={state as never} />);
      expect(text).toContain(en[`${K}ReviewFlowSteps.${state === 'done' ? 'done' : 'now'}`]);
      expect(text).not.toMatch(/appApplicant\./);
      for (const word of ['done', 'next', 'now'])
        expect(`${K}ReviewFlowSteps.${word}` in bn, word).toBe(false);
    }
  });
});

describe('the history and expiry pages under Bengali', () => {
  const history = () =>
    HistoryPage({ params: Promise.resolve({ id: 'person' }), searchParams: Promise.resolve({}) });
  const expiry = () => ExpiryPage({ params: Promise.resolve({ id: 'person' }) });

  it('shows the empty history in Bengali', async () => {
    const text = await server('bn', history);
    expect(text).toContain(bn[`${K}HistoryPage.nothingSavedToThisProfileYet`]);
    expect(text).toContain(bn[`${K}HistoryPage.history`]);
  });

  it('shows the expiry page in Bengali when nothing is saved, and keeps held sentences in English', async () => {
    const text = await server('bn', expiry);
    expect(text).toContain(bn[`${K}ExpiryPage.noDocumentsYet`]);
    expect(text).toContain(bn[`${K}ExpiryPage.documentExpiry`]);
    for (const key of [`${K}ExpiryPage.routeDateRules`, `${K}ExpiryPage.routeRules`]) {
      expect(key in bn, key).toBe(false);
      expect(text).toContain(en[key] ?? 'MISSING');
    }
  });

  it('shows the deadline clock with a held, counted phrase in English', async () => {
    service.listDeadlineClock.mockResolvedValue({
      ok: true,
      value: {
        applicantId: 'person',
        entries: [
          {
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
          },
        ],
      },
    });
    const text = await server('bn', expiry);
    expect(text).toContain(bn[`${K}ExpiryPage.deadlineClock`]);
  });

  it('renders the same English as before under English', async () => {
    const text = await server('en', expiry);
    expect(text).toContain('No Documents Yet');
    expect(text).not.toMatch(BENGALI);
    expect(await server('en', history)).not.toMatch(BENGALI);
  });
});

describe('dates and held wording', () => {
  it('writes a saved day in Bengali digits under Bengali and keeps English as it was', () => {
    expect(formatTimestampDate('2026-10-06T10:00:00Z', 'bn')).toMatch(BENGALI);
    expect(formatTimestampDate('2026-10-06T10:00:00Z', 'bn')).not.toMatch(/[0-9]/);
    expect(formatTimestampDate('2026-10-06T10:00:00Z')).toBe('6 Oct 2026');
    expect(formatTimestampDate('2026-10-06T10:00:00Z', 'en')).toBe('6 Oct 2026');
  });

  it('keeps the AI, file-promise, disclaimer and counted-phrase wording in English', () => {
    const held = [
      'AppSuggestions.pluralYourAiAppsSuggestedFor',
      'AiReview.changeItIfItIsNot',
      'DocumentSuggestionCard.nothingIsSavedUntilYouAccept',
      'DocumentsAddPage.dropYourFilesOrAWhole',
      'DocumentsAddReadingSwitch.automaticReadingStateWord',
      'ProfilePage.aiSuggestionsDoNotChangeYour',
      'ReviewPage.weCheckEachFileReadIt',
      'DocumentUploader.storedPrivatelyOnlyYouAndThe',
      'ImportImportPanel.eachFileIsStoredPrivatelyAnd',
      'ImportImportPanel.yourFilesAreSavedAndChecked',
      'DocumentsManageCopyKeepCopyAction.itIsASeparateCopyChecked',
      'DocumentsManageReplaceReplaceAction.theOldDocumentStaysInYour',
      'DocumentsManageRequestCancelAction.youAskedUsToRemoveDocumentname',
      'HistoryPage.everySavedValueIsKeptAnd',
      'RemovalRecordsPage.whatWasDeletedFromThisRecord',
      'Page.completenessDoesNotVerifyIdentity',
      'Page.requirementCompletenessIsNotAnApproval',
      'ExpiryPage.someVisaRoutesNeedADocument',
      'DocumentExpiryForm.savedlabelReadFromTheDocument',
      'ReviewPage.filesNotReadYet',
      'Page.aCaseIsWhereOneVisa',
      'ProfilePage.theDetailsMostVisaFormsAsk',
      'DocumentsNeedsDecision.removeThisFileLabel',
      'ProfileEditor.noLongerCurrentLabel',
      'ExpiryPage.expiresInPlural',
      'ExpiryPage.expiredPluralAgo',
      'ProfileEditor.iHaveNoTolowercase',
    ];
    for (const suffix of held) {
      expect(`${K}${suffix}` in en, suffix).toBe(true);
      expect(`${K}${suffix}` in bn, suffix).toBe(false);
    }
  });

  it('leaves no raw placeholder and no mismatched value in any Bengali string', () => {
    for (const [key, text] of Object.entries(bn)) {
      const names = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
      expect(names(text), key).toBe(names(en[key] ?? ''));
      expect(text, key).not.toMatch(/\{[^}\w]|[^\w]\}/);
      expect(text, key).not.toContain('নিরাপদ');
    }
  });
});
