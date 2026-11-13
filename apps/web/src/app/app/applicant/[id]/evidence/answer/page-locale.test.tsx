// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { evidenceAnswerCatalog } from '../../../../../../i18n/evidence-answer';
import { renderServer, stub, textOf } from '../../../../../../lib/next-mocks.test-support';
import { expectEveryLiveMessageRendered } from '../../bn-coverage.test-support';

/**
 * The Answer from Your Records page and its receipt under Bengali: every sentence of the page and
 * of the receipt is rendered by the real page for a Bengali reader, the English reader sees the
 * exact English, and the Bengali that sits in the page says which language it is in.
 */
vi.mock('@visastack/i18n', async (original) =>
  (await import('../../bn-coverage.test-support')).trackBengali(await original()),
);

const current = vi.hoisted(() => ({ locale: 'en' as 'en' | 'bn', holder: null as unknown }));
vi.mock('../../../../../../lib/locale', () => ({ getLocale: async () => current.locale }));
// Outside the server runtime React's cache remembers nothing; stand in for one request per render.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: (build: () => unknown) => () => {
    current.holder ??= build();
    return current.holder;
  },
}));

const mocks = vi.hoisted(() => ({
  getApplicant: vi.fn(),
  requireAccess: vi.fn(),
  planEvidenceAnswers: vi.fn(),
  readEvidenceAnswerReceipt: vi.fn(),
}));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  accountPrincipal: (accountId: string) => ({ kind: 'account', accountId }),
  getApplicant: mocks.getApplicant,
  requireAccess: mocks.requireAccess,
  planEvidenceAnswers: mocks.planEvidenceAnswers,
  readEvidenceAnswerReceipt: mocks.readEvidenceAnswerReceipt,
}));
vi.mock('../../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) => fn({ db: {}, accountId: 'owner' }),
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock('./answer-set-form', () => ({ AnswerSetForm: stub('AnswerSetForm') }));

const { default: AnswerPage } = await import('./page');

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const KEY = 'k9Qm2x_T7vLw4Rz0Hc8Yb1Nd';
const AGENCY = 'TEST Agency Unrelated';
const BENGALI = /[ঀ-৿]/;

const copy = (id: string) => ({
  documentId: `doc-${id}`,
  versionId: `ver-${id}`,
  versionNumber: 1,
  name: `${id}.pdf`,
  addedAt: new Date('2026-11-01T10:00:00Z'),
  expiresOn: null,
  documentDate: null,
  ageDays: null,
  state: 'OK',
  sendable: true,
  acceptedBefore: null,
});
const item = (id: string, readiness: string, copies: unknown[] = []) => ({
  requestId: `req-${id}`,
  referenceCode: null,
  kind: 'DOCUMENT',
  docType: 'PASSPORT',
  fieldKey: null,
  status: 'OPEN',
  missionId: null,
  dueDate: null,
  rule: null,
  readiness,
  copies,
});
const group = (organizationId: string, organizationName: string, items: unknown[]) => ({
  organizationId,
  organizationName,
  canReceive: true,
  items,
});
const plan = (agencies: unknown[], over: Record<string, unknown> = {}) => ({
  ok: true,
  value: { available: true, agencies, more: false, ...over },
});
const line = (id: string, state: string, over: Record<string, unknown> = {}) => ({
  submissionId: `sub-${id}`,
  requestId: `req-${id}`,
  referenceCode: 'R-7K2Q9M',
  docType: 'PASSPORT',
  title: `${id}.pdf`,
  versionNumber: 2,
  checksumFingerprint: 'abcdef123456',
  sentAt: new Date('2026-11-12T08:30:00Z'),
  state,
  ...over,
});
const several = () =>
  plan([
    group(ORG_A, AGENCY, [
      item('p', 'READY', [copy('p')]),
      item('b', 'READY', [copy('b')]),
      item('l', 'MISSING'),
    ]),
    group(ORG_B, 'TEST Agency North', [item('n', 'CHOOSE', [copy('n1'), copy('n2')])]),
  ]);

async function render(locale: 'en' | 'bn', search: Record<string, string> = {}) {
  current.locale = locale;
  current.holder = null;
  return renderServer(
    AnswerPage({ params: Promise.resolve({ id: 'a1' }), searchParams: Promise.resolve(search) }),
  );
}

/** The Bengali text of a page that no element marks as Bengali, in page order. */
function bengaliOutsideALanguageMark(html: string): string[] {
  const host = document.createElement('div');
  host.innerHTML = html;
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  const loose: string[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const value = (node.nodeValue ?? '').trim();
    if (BENGALI.test(value) && !node.parentElement?.closest('[lang="bn"]')) loose.push(value);
  }
  return loose;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getApplicant.mockResolvedValue({
    id: 'a1',
    ownerAccountId: 'owner',
    displayName: 'TEST Rahim Synthetic',
    timezone: 'Asia/Dhaka',
  });
  mocks.requireAccess.mockResolvedValue({ ok: true, value: { gate: 'proof' } });
  mocks.planEvidenceAnswers.mockResolvedValue(plan([]));
  mocks.readEvidenceAnswerReceipt.mockResolvedValue({
    ok: true,
    value: { organizationId: ORG_A, organizationName: '', lines: [] },
  });
});

describe('the page for a Bengali reader', () => {
  it('says the requests could not be loaded and that nothing was sent', async () => {
    mocks.requireAccess.mockResolvedValue({ ok: false });
    const text = textOf(await render('bn'));
    expect(text).toContain('আপনার রেকর্ড থেকে উত্তর দিন');
    expect(text).toContain('আপনার অনুরোধগুলো লোড করা যায়নি। কিছুই পাঠানো হয়নি। আবার চেষ্টা করতে রিফ্রেশ করুন।');
    expect(text).not.toContain('কিছু অপেক্ষায় নেই');
  });

  it('says answering in one step is not available yet', async () => {
    mocks.planEvidenceAnswers.mockResolvedValue(
      plan([group(ORG_A, AGENCY, [item('p', 'READY', [copy('p')])])], { available: false }),
    );
    expect(textOf(await render('bn'))).toContain(
      'এক ধাপে উত্তর দেওয়ার সুবিধা এখনো চালু হয়নি। তবে প্রতিটি অনুরোধের উত্তর তার নিজস্ব পাতায় দিতে পারবেন।',
    );
  });

  it('shows the empty state with the way back to the requests', async () => {
    const html = await render('bn');
    const text = textOf(html);
    expect(text).toContain('আপনার জন্য কিছু অপেক্ষায় নেই');
    expect(text).toContain('এই মুহূর্তে কোনো এজেন্সি আপনার উত্তরের অপেক্ষায় নেই।');
    expect(text).toContain('এজেন্সির অনুরোধ');
    expect(html).toContain('href="/app/applicant/a1/evidence"');
  });

  it('lists who is asking with the counts in Bengali digits, and keeps each agency name as written', async () => {
    mocks.planEvidenceAnswers.mockResolvedValue(several());
    const text = textOf(await render('bn'));
    expect(text).toContain('কে চাইছে');
    expect(text).toContain('৩টি অনুরোধ অপেক্ষায় · ২টি সংরক্ষিত রেকর্ড থেকে প্রস্তুত');
    expect(text).toContain('১টি অনুরোধ অপেক্ষায়');
    expect(text).toContain('উত্তরগুলো দেখে নিন');
    expect(text).toContain(AGENCY);
    expect(text).toContain('TEST Agency North');
  });

  it('heads the review with the agency and its count, with the way back to all agencies', async () => {
    mocks.planEvidenceAnswers.mockResolvedValue(several());
    const text = textOf(await render('bn', { agency: ORG_A }));
    expect(text).toContain(`${AGENCY}: ৩টি অনুরোধ অপেক্ষায়`);
    expect(text).toContain('সব এজেন্সি');
  });

  it('says more requests wait than are listed, with the link', async () => {
    mocks.planEvidenceAnswers.mockResolvedValue(
      plan([group(ORG_A, AGENCY, [item('p', 'READY', [copy('p')])])], { more: true }),
    );
    const text = textOf(await render('bn'));
    expect(text).toContain(
      'এখানে যতগুলো দেখানো হয়েছে তার চেয়ে বেশি অনুরোধ অপেক্ষায় আছে। সবগুলো দেখুন এখানে:',
    );
  });
});

describe('the receipt for a Bengali reader', () => {
  const receipt = () =>
    mocks.readEvidenceAnswerReceipt.mockResolvedValue({
      ok: true,
      value: {
        organizationId: ORG_A,
        organizationName: AGENCY,
        lines: [
          line('passport', 'WAITING_FOR_REVIEW'),
          line('bank', 'ACCEPTED'),
          line('photo', 'SENT_BACK'),
          line('letter', 'CLOSED', { checksumFingerprint: null }),
        ],
      },
    });

  it('names each exact copy and says where each one stands, without calling a received copy accepted', async () => {
    receipt();
    const html = await render('bn', { agency: ORG_A, done: KEY });
    const text = textOf(html);
    expect(text).toContain('উত্তর পাঠানো হয়েছে');
    expect(text).toContain(`৪টি হুবহু কপি ${AGENCY}-এর কাছে গেছে।`);
    expect(text).toContain('কপি ২ · ফিঙ্গারপ্রিন্ট abcdef123456 ·');
    expect(text).toMatch(/letter\.pdf\s*কপি ২ · (?!ফিঙ্গারপ্রিন্ট)/);
    expect(text).toContain('R-7K2Q9M');
    expect(html).toContain('অনুরোধের রেফারেন্স');
    expect(text).toContain('পাওয়া গেছে, এখনো পর্যালোচনা হয়নি');
    expect(text).toContain('গ্রহণ করা হয়েছে');
    expect(text).toContain('ফেরত পাঠানো হয়েছে');
    expect(text).toContain('বন্ধ');
    expect(text).toContain('passport.pdf');
  });

  it('says one copy went, for one', async () => {
    mocks.readEvidenceAnswerReceipt.mockResolvedValue({
      ok: true,
      value: {
        organizationId: ORG_A,
        organizationName: AGENCY,
        lines: [line('passport', 'WAITING_FOR_REVIEW')],
      },
    });
    const text = textOf(await render('bn', { agency: ORG_A, done: KEY }));
    expect(text).toContain(`১টি হুবহু কপি ${AGENCY}-এর কাছে গেছে।`);
    expect(text).not.toContain('গ্রহণ করা হয়েছে');
  });
});

describe('which language each part says it is in', () => {
  it('marks the Bengali inside the page; only the page title, the way back and the action names are plain text', async () => {
    mocks.planEvidenceAnswers.mockResolvedValue(several());
    const html = await render('bn');
    expect(html).toContain('lang="bn"');
    // The header and the empty-state action take a plain string, so their Bengali has no mark of
    // its own yet (the known gap of string props). This list may only get shorter.
    expect([...new Set(bengaliOutsideALanguageMark(html))].sort()).toEqual(
      ['আপনার রেকর্ড থেকে উত্তর দিন', 'এজেন্সির অনুরোধ'].sort(),
    );
  });

  it('marks every Bengali part of the receipt; the reference label and the empty-state title are string props', async () => {
    mocks.readEvidenceAnswerReceipt.mockResolvedValue({
      ok: true,
      value: {
        organizationId: ORG_A,
        organizationName: AGENCY,
        lines: [line('passport', 'WAITING_FOR_REVIEW'), line('bank', 'ACCEPTED')],
      },
    });
    const html = await render('bn', { agency: ORG_A, done: KEY });
    const loose = [...new Set(bengaliOutsideALanguageMark(html))].sort();
    expect(loose).toEqual(
      [
        'অনুরোধের রেফারেন্স',
        'আপনার জন্য কিছু অপেক্ষায় নেই',
        'আপনার রেকর্ড থেকে উত্তর দিন',
        'এজেন্সির অনুরোধ',
      ].sort(),
    );
  });
});

describe('the page for an English reader is unchanged', () => {
  it('shows the exact English, with no Bengali and no language marks', async () => {
    mocks.planEvidenceAnswers.mockResolvedValue(several());
    mocks.readEvidenceAnswerReceipt.mockResolvedValue({
      ok: true,
      value: {
        organizationId: ORG_A,
        organizationName: AGENCY,
        lines: [line('passport', 'WAITING_FOR_REVIEW'), line('bank', 'ACCEPTED')],
      },
    });
    const html = await render('en', { agency: ORG_A, done: KEY });
    const text = textOf(html);
    expect(text).toContain('Answer from Your Records');
    expect(text).toContain(`2 exact copies went to ${AGENCY}.`);
    expect(text).toContain('Version 2 · Fingerprint abcdef123456 ·');
    expect(text).toContain('Received, Not Yet Reviewed');
    expect(text).toContain(`${AGENCY}: 3 requests waiting`);
    expect(BENGALI.test(html)).toBe(false);
    expect(html).not.toContain('lang="bn"');
  });
});

describe('coverage', () => {
  it('rendered every Bengali sentence of the page and the receipt', () => {
    expectEveryLiveMessageRendered(evidenceAnswerCatalog, 'evidenceAnswer.page.');
    expectEveryLiveMessageRendered(evidenceAnswerCatalog, 'evidenceAnswer.receipt.');
  });
});
