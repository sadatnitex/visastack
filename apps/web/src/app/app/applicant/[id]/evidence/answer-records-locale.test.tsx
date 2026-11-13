// @vitest-environment jsdom
import type {
  AskingAgency,
  DocumentSummary,
  EvidenceRequest,
  FieldAnswerHistory,
  FieldAnswerRound,
} from '@visastack/services';
import { LEGACY_FIELD_ANSWER_LABEL } from '@visastack/services';
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { evidenceAnswerCatalog } from '../../../../../i18n/evidence-answer';
import {
  bengaliWithoutLanguageMark,
  expectEveryLiveMessageRendered,
} from '../bn-coverage.test-support';
import type { RequestHistory } from './request-thread-data';
import type { SentBackRead } from './sent-back-copy';

/**
 * The Answer from Your Records wording that lives on the Requests page, under Bengali: the card
 * that says who waits, the "asked by" line, what the person sent for a detail, the note about a
 * copy the agency sent back, and the date words beside each copy. Each is rendered by the real
 * card and the real panel, in Bengali for a Bengali reader and in the exact English otherwise.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@visastack/i18n', async (original) =>
  (await import('../bn-coverage.test-support')).trackBengali(await original()),
);
const current = vi.hoisted(() => ({ locale: 'en' as 'en' | 'bn', holder: null as unknown }));
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
  unstable_rethrow: () => undefined,
}));
vi.mock('./actions', () => ({
  submitEvidenceResponseAction: vi.fn(),
  askAboutRequestItemAction: vi.fn(),
}));
vi.mock('./clearer-copy-panel', () => ({ ClearerCopyPanel: () => null }));
// The conversation is an async server component and this test mounts in the browser: it is not
// what this test is about, so it is left out here (its own tests render it on the server).
vi.mock('../../../../../components/request-thread/request-thread', () => ({
  RequestThread: () => null,
}));

const { primePage } = await import('../../../../../lib/i18n-server');
const { requestPanes } = await import('./request-panes');
const { requestItemView } = await import('./request-item');
const { AnswerFromRecordsCard } = await import('./answer-from-records-card');

const ID = '11111111-1111-4111-8111-111111111111';
const AGENCY = 'TEST Agency Unrelated';
const BENGALI = /[ঀ-৿]/;
const future = new Date(Date.now() + 400 * 86400_000).toISOString();
const past = new Date(Date.now() - 30 * 86400_000).toISOString();

const request = (over: Partial<EvidenceRequest> = {}): EvidenceRequest =>
  ({
    id: ID,
    kind: 'DOCUMENT',
    status: 'OPEN',
    fieldKey: null,
    docType: 'BANK_STATEMENT',
    message: null,
    createdAt: new Date('2026-11-01T00:00:00Z'),
    respondedAt: null,
    dueDate: null,
    missionId: null,
    respondingDocumentId: null,
    respondingFactId: null,
    organizationId: 'org-1',
    ...over,
  }) as unknown as EvidenceRequest;
const detailRequest = () =>
  request({
    kind: 'FIELD',
    status: 'ACCEPTED',
    fieldKey: 'phone',
    docType: null,
    respondedAt: new Date('2026-11-02T00:00:00Z'),
    respondingFactId: 'f1',
  } as Partial<EvidenceRequest>);

const doc = (id: string, over: Partial<DocumentSummary> = {}): DocumentSummary =>
  ({
    id,
    originalName: `${id}.pdf`,
    approvedName: null,
    docType: 'BANK_STATEMENT',
    latestVersionId: `v-${id}`,
    safetyStatus: 'CLEAN',
    processingStatus: 'AWAITING_REVIEW',
    createdAt: '2026-10-01T00:00:00Z',
    expiresAt: future,
    ...over,
  }) as DocumentSummary;

const version = {
  id: 'v1',
  number: 1,
  savedAt: new Date('2026-11-01T10:00:00Z'),
  protected: false,
  value: '+8801700000111' as string | null,
  stillCurrent: false,
};
const round = (over: Partial<FieldAnswerRound> = {}): FieldAnswerRound => ({
  submissionId: 's1',
  roundNo: 1,
  precision: 'pinned',
  sentAt: new Date('2026-11-02T00:00:00Z'),
  state: 'ACCEPTED',
  decidedAt: new Date('2026-11-03T00:00:00Z'),
  reason: null,
  version,
  ...over,
});
const detailHistory = (fieldAnswer: RequestHistory['fieldAnswer']): RequestHistory => ({
  decisions: { state: 'none' },
  sends: { state: 'none' },
  sentBack: { state: 'none' },
  fieldAnswer,
});
const rounds = (list: FieldAnswerRound[]): RequestHistory['fieldAnswer'] => ({
  state: 'read',
  value: {
    available: true,
    rounds: list,
    legacyLabel: LEGACY_FIELD_ANSWER_LABEL,
  } as FieldAnswerHistory,
});
const sentBackHistory = (sentBack: SentBackRead): RequestHistory => ({
  decisions: { state: 'none' },
  sends: { state: 'none' },
  sentBack,
  fieldAnswer: { state: 'none' },
});
const sentBackCopy = (over: Record<string, unknown> = {}): SentBackRead => ({
  state: 'copy',
  copy: {
    precision: 'exact',
    documentId: 'old',
    versionId: 'v-old',
    versionNumber: 1,
    title: 'old-statement.pdf',
    sentAt: new Date('2026-11-01T10:00:00Z'),
    reason: 'Page 2 is cut off.',
    ...over,
  } as never,
});

async function pane(
  locale: 'en' | 'bn',
  args: {
    req?: EvidenceRequest;
    documents?: DocumentSummary[];
    history?: RequestHistory | null;
    askingAgencies?: ReadonlyMap<string, string>;
  },
) {
  current.locale = locale;
  current.holder = null;
  await primePage();
  const req = args.req ?? request();
  const documents = args.documents ?? [];
  const [first] = requestPanes({
    applicantId: 'a1',
    timeZone: 'Asia/Dhaka',
    locale,
    entries: [{ req, item: requestItemView({ request: req }) }],
    referenceCodes: new Map(),
    profile: [{ factId: 'f1', fieldKey: 'phone', value: '+8801700000999' }],
    documents,
    documentsRead: true,
    extras: { questions: new Map() } as never,
    choiceBasis: {
      read: true,
      exactCopies: true,
      everyday: new Set(documents.map((d) => d.id.toLowerCase())),
      scan: new Map(),
    },
    histories: args.history ? new Map([[ID, args.history]]) : new Map(),
    ...(args.askingAgencies ? { askingAgencies: args.askingAgencies } : {}),
  });
  return first?.content;
}
async function card(locale: 'en' | 'bn', agencies: AskingAgency[]) {
  current.locale = locale;
  current.holder = null;
  await primePage();
  return <AnswerFromRecordsCard applicantId="a1" agencies={agencies} />;
}
const asking = (organizationId: string, organizationName: string, waiting: number) =>
  ({ organizationId, organizationName, waiting, waitingDocuments: waiting }) as AskingAgency;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
const show = async (content: unknown) =>
  act(async () => root.render(content as Parameters<Root['render']>[0]));
const text = () => host.textContent ?? '';
const part = (testId: string) => host.querySelector(`[data-testid=${testId}]`)?.textContent ?? '';

describe('the card that says who waits, for a Bengali reader', () => {
  it('names the one agency and its count in Bengali digits, with the one button', async () => {
    await show(await card('bn', [asking('org-1', AGENCY, 6)]));
    expect(text()).toContain(`${AGENCY} ৬টি উত্তরের অপেক্ষায় আছে`);
    expect(text()).toContain('আপনার রেকর্ড থেকে উত্তর দিন');
    expect(bengaliWithoutLanguageMark(host)).toEqual([]);
  });

  it('lists several agencies under a Bengali heading, each name as written', async () => {
    await show(
      await card('bn', [asking('org-1', AGENCY, 1), asking('org-2', 'TEST Agency North', 3)]),
    );
    expect(text()).toContain('উত্তরের অপেক্ষায়');
    expect(text()).toContain(`${AGENCY}: ১টি উত্তর`);
    expect(text()).toContain('TEST Agency North: ৩টি উত্তর');
    expect(bengaliWithoutLanguageMark(host)).toEqual([]);
  });

  it('is unchanged for an English reader', async () => {
    await show(await card('en', [asking('org-1', AGENCY, 6)]));
    expect(text()).toContain(`${AGENCY} is waiting for 6 answers`);
    expect(text()).toContain('Answer from Your Records');
    expect(BENGALI.test(text())).toBe(false);
    expect(host.querySelectorAll('[lang]').length).toBe(0);
  });
});

describe('a request panel for a Bengali reader', () => {
  it('names the agency that asked, as written', async () => {
    await show(
      await pane('bn', { documents: [doc('a')], askingAgencies: new Map([['org-1', AGENCY]]) }),
    );
    expect(text()).toContain(`${AGENCY} এটি চেয়েছে`);
  });

  it('words the expiry of a current copy and of an expired one', async () => {
    await show(await pane('bn', { documents: [doc('a'), doc('b', { expiresAt: past })] }));
    expect(text()).toMatch(/মেয়াদ শেষ হবে [^ ]/);
    expect(text()).toMatch(/তারিখে মেয়াদ শেষ হয়েছে/);
  });

  it('says the saved expiry dates disagree, and what to do when every saved copy is out of date', async () => {
    await show(
      await pane('bn', {
        documents: [
          doc('a', {
            expiry: { origin: 'READ', typedOn: null, mismatch: true, canType: true },
          } as Partial<DocumentSummary>),
        ],
      }),
    );
    expect(text()).toContain(
      'সংরক্ষিত মেয়াদ শেষের তারিখগুলো মিলছে না। এই কপি পাঠানোর আগে সেগুলো দেখে নিন।',
    );
    await show(await pane('bn', { documents: [doc('old', { expiresAt: past })] }));
    expect(part('no-current-copy-note')).toBe(
      'সংরক্ষিত প্রতিটি কপির মেয়াদ শেষ হয়েছে অথবা তারিখ মিলিয়ে দেখা দরকার। একটি বর্তমান কপি যোগ করুন, অথবা যেমন আছে তেমনই পাঠাতে নিজে একটি পুরোনো কপি বেছে নিন।',
    );
    expect(
      bengaliWithoutLanguageMark(
        host.querySelector('[data-testid=no-current-copy-note]') as Element,
      ),
    ).toEqual([]);
  });
});

describe('the copy an agency sent back, for a Bengali reader', () => {
  const sentBack = (read: SentBackRead, documents: DocumentSummary[] = [doc('new')]) =>
    pane('bn', {
      req: request({ status: 'NEEDS_REPLACEMENT' } as Partial<EvidenceRequest>),
      documents,
      history: sentBackHistory(read),
    });

  it('names the exact copy and when it was sent, in Bengali digits', async () => {
    await show(await sentBack(sentBackCopy()));
    const note = part('sent-back-note');
    expect(note).toContain('এজেন্সি old-statement.pdf-এর কপি ১ ফেরত পাঠিয়েছে, যেটি আপনি');
    expect(note).toContain('তারিখে পাঠিয়েছিলেন।');
    expect(
      bengaliWithoutLanguageMark(host.querySelector('[data-testid=sent-back-note]') as Element),
    ).toEqual([]);
  });

  it('says it cannot name the copy number when only the document is known', async () => {
    await show(
      await sentBack(sentBackCopy({ precision: 'document', versionNumber: null, sentAt: null })),
    );
    expect(part('sent-back-note')).toBe(
      'এজেন্সি old-statement.pdf ফেরত পাঠিয়েছে। এর কোন কপিটি, তা এই পাতায় বলা সম্ভব নয়।',
    );
  });

  it('says "this document" when the copy has no name left', async () => {
    await show(
      await sentBack(
        sentBackCopy({
          precision: 'document',
          versionNumber: null,
          sentAt: null,
          title: null,
          documentId: 'gone',
        }),
      ),
    );
    expect(part('sent-back-note')).toContain('এজেন্সি এই ডকুমেন্ট ফেরত পাঠিয়েছে।');
  });

  it('chooses nothing and says so when the page cannot tell which copy it was', async () => {
    await show(await sentBack({ state: 'unknown' }));
    expect(part('sent-back-note')).toBe(
      'এজেন্সি একটি উত্তর ফেরত পাঠিয়েছে, কিন্তু সেটি কোন কপি ছিল তা এই পাতায় বোঝা যাচ্ছে না। আপনার হয়ে কিছুই বেছে রাখা হয়নি। কোন কপিটি পাঠাবেন তা নিজে বেছে নিন।',
    );
    expect(
      [...host.querySelectorAll<HTMLInputElement>('input[type=radio]')].filter((r) => r.checked),
    ).toHaveLength(0);
  });
});

describe('what you sent for a detail, for a Bengali reader', () => {
  const detail = (fieldAnswer: RequestHistory['fieldAnswer']) =>
    pane('bn', { req: detailRequest(), history: detailHistory(fieldAnswer) });

  it('shows the exact saved value and its number, says it changed since, and never the detail as it is now', async () => {
    await show(await detail(rounds([round()])));
    const sent = part('field-answer-sent');
    expect(sent).toContain('আপনি যা পাঠিয়েছেন');
    expect(sent).toContain('গ্রহণ করা হয়েছে');
    expect(sent).toContain('সংস্করণ ১,');
    expect(sent).toContain('সংরক্ষিত: +8801700000111');
    expect(sent).toContain('এরপর এই তথ্যটি বদলেছে। এর নতুন মানটি পাঠানো হয়নি।');
    expect(sent).not.toContain('+8801700000999');
    expect(
      bengaliWithoutLanguageMark(host.querySelector('[data-testid=field-answer-sent]') as Element),
    ).toEqual([]);
  });

  it('says where each round stands: waiting, sent back, withdrawn', async () => {
    await show(
      await detail(
        rounds([
          round({ state: 'NEEDS_REPLACEMENT' }),
          round({ submissionId: 's2', roundNo: 2, state: 'WITHDRAWN' as never }),
          round({ submissionId: 's3', roundNo: 3, state: 'AWAITING_DECISION' as never }),
        ]),
      ),
    );
    const sent = part('field-answer-sent');
    expect(sent).toContain('এজেন্সির অপেক্ষায়');
    expect(sent).toContain('ফেরত পাঠানো হয়েছে');
    expect(sent).toContain('এজেন্সি প্রত্যাহার করেছে');
  });

  it('names a protected detail by its number only', async () => {
    await show(
      await detail(rounds([round({ version: { ...version, protected: true, value: null } })])),
    );
    expect(part('field-answer-sent')).toContain('একটি সুরক্ষিত তথ্য, এখানে দেখানো হয় না।');
    expect(part('field-answer-sent')).not.toContain('+8801700000111');
  });

  it('admits that an answer sent before the exact value was kept cannot show it', async () => {
    await show(
      await detail(
        rounds([round({ submissionId: null, roundNo: null, precision: 'legacy', version: null })]),
      ),
    );
    expect(part('field-answer-sent')).toContain(
      'হুবহু মান রেখে দেওয়া শুরুর আগে এটি পাঠানো হয়েছিল। কোন মানটি পাঠানো হয়েছিল তা এই পাতায় দেখানো সম্ভব নয়।',
    );
    expect(part('field-answer-sent')).not.toContain('+8801700000999');
  });

  it('says so when the value could not be loaded', async () => {
    await show(await detail({ state: 'unread' }));
    expect(part('field-answer-sent')).toBe('আপনার পাঠানো মানটি লোড করা যায়নি।');
  });
});

describe('the same panels for an English reader are unchanged', () => {
  it('keeps the exact English for a detail answer and marks nothing', async () => {
    await show(
      await pane('en', {
        req: detailRequest(),
        history: detailHistory(rounds([round()])),
        askingAgencies: new Map([['org-1', AGENCY]]),
      }),
    );
    const sent = part('field-answer-sent');
    expect(sent).toContain('What You Sent');
    expect(sent).toContain('Version 1, saved');
    expect(sent).toContain('This detail has changed since. Its newer value was not sent.');
    expect(text()).toContain(`Asked by ${AGENCY}`);
    expect(BENGALI.test(text())).toBe(false);
  });

  it('keeps the exact English for a copy sent back', async () => {
    await show(
      await pane('en', {
        req: request({ status: 'NEEDS_REPLACEMENT' } as Partial<EvidenceRequest>),
        documents: [doc('new')],
        history: sentBackHistory(sentBackCopy()),
      }),
    );
    expect(part('sent-back-note')).toContain(
      'The agency sent back old-statement.pdf, version 1, which you sent on',
    );
    expect(BENGALI.test(text())).toBe(false);
  });
});

describe('coverage', () => {
  it('rendered every Bengali sentence of the card and the panels', () => {
    for (const group of ['waitingCard', 'panes', 'choices', 'fieldAnswer', 'sentBack'])
      expectEveryLiveMessageRendered(evidenceAnswerCatalog, `evidenceAnswer.${group}.`);
  });
});
