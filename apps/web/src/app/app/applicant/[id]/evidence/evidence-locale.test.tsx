import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../../components/i18n-provider';
import { renderServer, stub, textOf } from '../../../../../lib/next-mocks.test-support';
import { expectEveryLiveMessageRendered } from '../bn-coverage.test-support';
import type { DocumentChoice } from './response-choices';

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
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  unstable_rethrow: () => undefined,
}));
vi.mock('./actions', () => ({
  submitEvidenceResponseAction: vi.fn(),
  askAboutRequestItemAction: vi.fn(),
}));

const mocks = vi.hoisted(() => ({
  getApplicant: vi.fn(),
  listEvidenceRequestsForApplicant: vi.fn(),
  referenceCodesFor: vi.fn(),
  listDocumentsDetailed: vi.fn(),
  listRequestHistoriesForOwner: vi.fn(),
  requireAccess: vi.fn(),
  listRequestItemExtras: vi.fn(),
  getDocumentLifecycles: vi.fn(),
  loadVersionScanEvidence: vi.fn(),
  evidenceSubmissionsPresent: vi.fn(),
}));
/** The page asks for one page of requests: this turns a plain list into the page the service returns. */
async function requestPage(...args: unknown[]) {
  const listed = (await mocks.listEvidenceRequestsForApplicant(...args)) as
    | { ok: true; value: { status: string }[] }
    | { ok: false };
  if (!listed.ok) return listed;
  return {
    ok: true,
    value: {
      items: listed.value,
      more: false,
      counts: {
        total: listed.value.length,
        awaiting: listed.value.filter(
          (item) => item.status === 'OPEN' || item.status === 'NEEDS_REPLACEMENT',
        ).length,
      },
    },
  };
}
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  getApplicant: mocks.getApplicant,
  listEvidenceRequestsForApplicant: requestPage,
  referenceCodesFor: mocks.referenceCodesFor,
  listApplicantProfile: async () => [],
  listDocumentsDetailed: mocks.listDocumentsDetailed,
  listRequestHistoriesForOwner: mocks.listRequestHistoriesForOwner,
  requireAccess: mocks.requireAccess,
  listRequestItemExtras: mocks.listRequestItemExtras,
  getDocumentLifecycles: mocks.getDocumentLifecycles,
  loadVersionScanEvidence: mocks.loadVersionScanEvidence,
  evidenceSubmissionsPresent: mocks.evidenceSubmissionsPresent,
}));
vi.mock('../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) => fn({ db: {}, accountId: 'owner' }),
}));
vi.mock('../../../../../lib/ccd/depth.server', () => ({ readDepth: async () => 'auto' }));
vi.mock('./submit-response-form', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./submit-response-form')>()),
  SubmitResponseForm: stub('SubmitResponseForm'),
}));
vi.mock('./ask-about-item-form', () => ({ AskAboutItemForm: stub('AskAboutItemForm') }));
vi.mock('./clearer-copy-panel', () => ({ ClearerCopyPanel: stub('ClearerCopyPanel') }));

const { default: EvidencePage } = await import('./page');
const { AskAboutItemForm } =
  await vi.importActual<typeof import('./ask-about-item-form')>('./ask-about-item-form');
const { SubmitResponseForm } =
  await vi.importActual<typeof import('./submit-response-form')>('./submit-response-form');
const { AnswerReceipt } = await import('./answer-receipt');
const { applicantEvidenceCatalog } = await import('../../../../../i18n/applicant-evidence');

const bn = applicantEvidenceCatalog.bn as Record<string, string>;
const en = applicantEvidenceCatalog.en as Record<string, string>;
const PAGE = 'applicantEvidence.appApplicantIdEvidencePage.';
const PANES = 'applicantEvidence.appApplicantIdEvidenceRequestPanes.';
const FORM = 'applicantEvidence.appApplicantIdEvidenceSubmitResponseForm.';
const ASK = 'applicantEvidence.appApplicantIdEvidenceAskAboutItemForm.';
const RECEIPT = 'applicantEvidence.appApplicantIdEvidenceAnswerReceipt.';
const RAW_KEY = /applicant[A-Z][A-Za-z]+\.app[A-Z]/;
const BENGALI = /[ঀ-৿]/;

const request = {
  id: 'r1',
  kind: 'DOCUMENT',
  docType: 'BANK_STATEMENT',
  fieldKey: null,
  status: 'OPEN',
  message: null,
  dueDate: null,
  missionId: null,
  respondingDocumentId: null,
  respondedAt: null,
};

async function page(locale: 'en' | 'bn') {
  current.holder = null;
  current.locale = locale;
  const html = await renderServer(EvidencePage({ params: Promise.resolve({ id: 'a1' }) }));
  return { html, text: textOf(html) };
}

function client(locale: 'en' | 'bn', node: React.ReactNode) {
  const html = renderToStaticMarkup(
    <I18nProvider locale={locale} pageLang={locale}>
      {node}
    </I18nProvider>,
  );
  return { html, text: textOf(html) };
}

beforeEach(() => {
  mocks.getApplicant.mockResolvedValue({
    id: 'a1',
    ownerAccountId: 'owner',
    displayName: 'R',
    timezone: 'Asia/Dhaka',
  });
  mocks.listEvidenceRequestsForApplicant.mockResolvedValue({ ok: true, value: [request] });
  mocks.referenceCodesFor.mockResolvedValue(new Map([['r1', 'R-7K2Q9M']]));
  mocks.listDocumentsDetailed.mockResolvedValue({ ok: true, value: [] });
  mocks.requireAccess.mockResolvedValue({ ok: true, value: { gate: 'proof' } });
  mocks.listRequestItemExtras.mockResolvedValue({
    ok: true,
    value: { rules: new Map(), questions: new Map() },
  });
  mocks.getDocumentLifecycles.mockResolvedValue(new Map());
  mocks.loadVersionScanEvidence.mockResolvedValue(new Map());
  mocks.evidenceSubmissionsPresent.mockResolvedValue(true);
  mocks.listRequestHistoriesForOwner.mockResolvedValue({ ok: true, value: new Map() });
});
afterEach(() => {
  current.locale = 'en';
});

describe('the requests page under Bengali', () => {
  it('a request still waiting shows the Bengali title, About Requests and reference label, and keeps the agency wording in English', async () => {
    const { html, text } = await page('bn');
    expect(text).toContain(bn[`${PAGE}requestsFromAgencies`]);
    expect(text).toContain(bn[`${PAGE}aboutRequests`]);
    expect(text).toContain(bn[`${PANES}requestReference`]);
    expect(html).toContain('R-7K2Q9M');
    // Held in English: the line that an agency request is not a government rule, the count, the status.
    expect(text).toContain(en[`${PAGE}anAgencyIsAskingYouFor`]);
    expect(text).toContain(en[`${PAGE}anAgencyRequestIsThatOrganisation`]);
    expect(text).toContain('1 request is waiting for you.');
    expect(text).toContain('Missing');
    expect(text).not.toContain(bn[`${PAGE}nothingIsWaitingForYou`]);
    expect(html).not.toMatch(RAW_KEY);
  });

  it('when every request is answered it says in Bengali that nothing is waiting', async () => {
    mocks.listEvidenceRequestsForApplicant.mockResolvedValue({
      ok: true,
      value: [{ ...request, status: 'ACCEPTED', respondedAt: new Date('2026-10-27T08:32:00Z') }],
    });
    const { html, text } = await page('bn');
    expect(text).toContain(bn[`${PAGE}nothingIsWaitingForYou`]);
    expect(text).toContain(bn[`${PAGE}requestsFromAgencies`]);
    expect(text).not.toContain('request is waiting for you');
    expect(html).not.toMatch(RAW_KEY);
  });

  it('with no requests it keeps the empty-state wording in English under the Bengali title', async () => {
    mocks.listEvidenceRequestsForApplicant.mockResolvedValue({ ok: true, value: [] });
    const { html, text } = await page('bn');
    expect(text).toContain(bn[`${PAGE}requestsFromAgencies`]);
    expect(text).toContain('No Evidence Requests');
    expect(text).toContain(en[`${PAGE}thisIsWhereAnAgencyAsks`]);
    expect(text).not.toContain(bn[`${PAGE}nothingIsWaitingForYou`]);
    expect(html).not.toMatch(RAW_KEY);
  });

  it('when the requests cannot be loaded it keeps the warning in English', async () => {
    mocks.listEvidenceRequestsForApplicant.mockResolvedValue({ ok: false });
    const { text } = await page('bn');
    expect(text).toContain(en[`${PAGE}yourRequestsCouldNotBeLoaded`]);
    expect(text).not.toMatch(RAW_KEY);
  });

  it('is the same English as before under English, with no Bengali', async () => {
    const { text } = await page('en');
    expect(text).not.toMatch(BENGALI);
    expect(text).toContain('Requests from Agencies');
    expect(text).toContain('About Requests');
    expect(text).toContain('Request Reference');
  });
});

const choice = (documentId: string, over: Partial<DocumentChoice> = {}): DocumentChoice => ({
  documentId,
  versionId: `version-of-${documentId}`,
  name: `Bank Statement ${documentId}`,
  kindLabel: 'Bank Statement',
  addedLabel: `${documentId} added`,
  scanLabel: 'Format Checked',
  scanDetail: 'The file type and structure were checked.',
  usable: true,
  sentBack: false,
  newest: false,
  ...over,
});

const submit = (props: Partial<React.ComponentProps<typeof SubmitResponseForm>> = {}) => (
  <SubmitResponseForm
    applicantId="a1"
    requestId="r1"
    kind="DOCUMENT"
    candidateFacts={[]}
    documentChoices={[]}
    idempotencyKey="k9Qm2x_T7vLw4Rz0Hc8Yb1Nd"
    {...props}
  />
);

describe('the reply form under Bengali', () => {
  it('asking for a document with no copy says so in Bengali and keeps the Open Documents button in English', () => {
    const { html, text } = client('bn', submit());
    expect(text).toContain(bn[`${FORM}noCopyOfThisDocumentType`]);
    expect(text).toContain(en[`${FORM}openDocuments`]);
    expect(html).not.toMatch(RAW_KEY);
  });

  it('a single fitting copy is chosen: Bengali legend and About Sending, English hint and consent line', () => {
    const { html, text } = client(
      'bn',
      submit({ documentChoices: [choice('d1')], exactCopies: true }),
    );
    expect(html).toMatch(new RegExp(`<legend[^>]*>${bn[`${FORM}chooseTheCopyToSend`]}</legend>`));
    expect(text).toContain(bn[`${FORM}aboutSending`]);
    expect(text).toContain('This is the only one that fits, so it is already chosen.');
    expect(text).toContain('Sending lets the agency download this exact copy');
    expect(text).toContain('Send to the Agency');
    expect(text).not.toContain(bn[`${FORM}newest`]);
    expect(html).not.toMatch(RAW_KEY);
  });

  it('several copies mark the newest in Bengali', () => {
    const { text } = client(
      'bn',
      submit({ documentChoices: [choice('d1'), choice('d2', { newest: true })] }),
    );
    expect(text).toContain(bn[`${FORM}newest`]);
    expect(text).toContain('Choose which one to send.');
    expect(text).not.toContain(bn[`${FORM}sentBackByTheAgency`]);
    expect(text).not.toMatch(RAW_KEY);
  });

  it('a copy the agency sent back is marked in Bengali, with the hint left in English', () => {
    const { text } = client(
      'bn',
      submit({ documentChoices: [choice('d1', { sentBack: true }), choice('d2')] }),
    );
    expect(text).toContain(bn[`${FORM}sentBackByTheAgency`]);
    expect(text).toContain('The copy the agency sent back is marked.');
    expect(text).not.toMatch(RAW_KEY);
  });

  it('asking for a detail shows the Bengali detail legend and the person values as they are', () => {
    const { html, text } = client(
      'bn',
      submit({ kind: 'FIELD', candidateFacts: [{ factId: 'f1', value: 'A1234567' }] }),
    );
    expect(html).toMatch(new RegExp(`<legend[^>]*>${bn[`${FORM}chooseTheDetailToSend`]}</legend>`));
    expect(text).toContain('A1234567');
    expect(text).toContain('Send to the Agency');
    expect(html).not.toMatch(RAW_KEY);
  });

  it('a detail with nothing recorded yet and unreadable documents stay in English', () => {
    const none = client('bn', submit({ kind: 'FIELD' }));
    expect(none.text).toContain('You have not recorded this field yet.');
    const unread = client('bn', submit({ documentsRead: false }));
    expect(unread.text).toContain(en[`${FORM}yourDocumentsCouldNotBeLoaded`]);
    expect(none.text + unread.text).not.toMatch(BENGALI);
  });

  it('is the same English as before under English', () => {
    const { text } = client(
      'en',
      submit({
        documentChoices: [choice('d1'), choice('d2', { newest: true })],
        exactCopies: true,
      }),
    );
    expect(text).not.toMatch(BENGALI);
    expect(text).toContain('Choose the Copy to Send');
    expect(text).toContain('Newest');
    expect(text).toContain('About Sending');
  });
});

describe('the question form and the receipt under Bengali', () => {
  it('the question form shows a Bengali label and keeps the who-can-read warning and the button in English', () => {
    const { html, text } = client(
      'bn',
      <AskAboutItemForm applicantId="a1" missionId="m1" requestId="r1" maxLength={500} />,
    );
    expect(html).toMatch(new RegExp(`<label[^>]*>${bn[`${ASK}yourQuestion`]}</label>`));
    expect(text).toContain('Everyone who can read the shared notes on this case');
    expect(text).toContain('Up to 500 characters');
    expect(text).toContain('Send Question');
    expect(`${ASK}everyoneWhoCanReadTheShared` in bn).toBe(false);
    expect(html).not.toMatch(RAW_KEY);
  });

  it('the receipt shows the Bengali title and keeps what was sent and the buttons in English', () => {
    const { html, text } = client(
      'bn',
      <AnswerReceipt
        applicantId="a1"
        itemName="Bank Statement"
        respondedAt="2026-11-01T08:00:00.000Z"
        timeZone="Asia/Dhaka"
        referenceCode="R-7K2Q9M"
      />,
    );
    expect(text).toContain(bn[`${RECEIPT}answerSent`]);
    expect(text).toContain('Bank Statement went to the agency.');
    expect(text).toContain('Back to Requests');
    expect(html).not.toMatch(RAW_KEY);
  });

  it('is the same English as before under English', () => {
    const ask = client(
      'en',
      <AskAboutItemForm applicantId="a1" missionId="m1" requestId="r1" maxLength={500} />,
    );
    const receipt = client(
      'en',
      <AnswerReceipt
        applicantId="a1"
        itemName="Bank Statement"
        respondedAt="2026-11-01T08:00:00.000Z"
        timeZone="Asia/Dhaka"
      />,
    );
    expect(ask.text + receipt.text).not.toMatch(BENGALI);
    expect(ask.text).toContain('Your Question');
    expect(receipt.text).toContain('Answer Sent');
  });
});

describe('Bengali coverage of the requests surface', () => {
  it('every live Bengali message was rendered by a test above', () => {
    expectEveryLiveMessageRendered(applicantEvidenceCatalog);
  });
});
