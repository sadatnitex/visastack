import { beforeEach, describe, expect, it, vi } from 'vitest';
import { evidenceAnswerCatalog } from '../../../../../../i18n/evidence-answer';
import { expectEveryLiveMessageRendered } from '../../bn-coverage.test-support';

/**
 * What the send says back, for a Bengali reader and for an English one: every sentence the action
 * can answer with is produced by the real action, in Bengali (with Bengali digits) or in the exact
 * English, and the outcome itself (sent, changed, ok) never depends on the language.
 */
vi.mock('@visastack/i18n', async (original) =>
  (await import('../../bn-coverage.test-support')).trackBengali(await original()),
);

const current = vi.hoisted(() => ({ locale: 'en' as 'en' | 'bn', holder: null as unknown }));
vi.mock('../../../../../../lib/locale', () => ({ getLocale: async () => current.locale }));
// Outside the server runtime React's cache remembers nothing; stand in for one request per call.
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
  confirmEvidenceAnswers: vi.fn(),
}));
vi.mock('@visastack/services', () => ({
  MAX_ANSWERS_PER_CONFIRMATION: 25,
  accountPrincipal: (accountId: string) => ({ kind: 'account', accountId }),
  getApplicant: mocks.getApplicant,
  requireAccess: mocks.requireAccess,
  confirmEvidenceAnswers: mocks.confirmEvidenceAnswers,
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/server', () => ({ after: () => undefined }));
vi.mock('../../../../../../lib/jobs', () => ({ triggerNotificationWorker: vi.fn() }));
vi.mock('../../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: { tag: 'db' }, accountId: 'owner' }),
}));

const { confirmAnswersAction } = await import('./actions');

const PREV = { ok: true, message: '', sent: 0, changed: 0 };
const AGENCY = 'TEST Agency Unrelated';
const form = (answers: string[], over: Record<string, string> = {}) => {
  const data = new FormData();
  const base: Record<string, string> = {
    applicantId: 'a1',
    organizationId: 'org-1',
    confirmationKey: 'k9Qm2x_T7vLw4Rz0Hc8Yb1Nd',
    ...over,
  };
  for (const [key, value] of Object.entries(base)) data.set(key, value);
  for (const answer of answers) data.append('answer', answer);
  return data;
};
const confirmation = (over: Record<string, unknown> = {}) => ({
  ok: true,
  value: {
    organizationId: 'org-1',
    organizationName: AGENCY,
    outcomes: [],
    sent: 0,
    alreadySent: 0,
    changed: 0,
    ...over,
  },
});
const answers = (n: number) => Array.from({ length: n }, (_unused, i) => `r${i}|d${i}|v${i}`);
const send = (locale: 'en' | 'bn', data: FormData) => {
  current.locale = locale;
  current.holder = null;
  return confirmAnswersAction(PREV, data);
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getApplicant.mockResolvedValue({ id: 'a1', ownerAccountId: 'owner' });
  mocks.requireAccess.mockResolvedValue({ ok: true, value: { gate: 'proof' } });
});

/** Each case: how to set it up, what is posted, and the sentence in each language. */
const CASES: ReadonlyArray<{
  readonly name: string;
  readonly setup: () => void;
  readonly data: () => FormData;
  readonly en: string;
  readonly bn: string;
}> = [
  {
    name: 'every answer went',
    setup: () => mocks.confirmEvidenceAnswers.mockResolvedValue(confirmation({ sent: 3 })),
    data: () => form(answers(3)),
    en: `3 answers were sent to ${AGENCY}.`,
    bn: `${AGENCY}-কে ৩টি উত্তর পাঠানো হয়েছে।`,
  },
  {
    name: 'one answer went',
    setup: () => mocks.confirmEvidenceAnswers.mockResolvedValue(confirmation({ sent: 1 })),
    data: () => form(answers(1)),
    en: `1 answer was sent to ${AGENCY}.`,
    bn: `${AGENCY}-কে ১টি উত্তর পাঠানো হয়েছে।`,
  },
  {
    name: 'the agency has no name on record',
    setup: () =>
      mocks.confirmEvidenceAnswers.mockResolvedValue(
        confirmation({ sent: 2, organizationName: '' }),
      ),
    data: () => form(answers(2)),
    en: '2 answers were sent to the agency.',
    bn: 'এজেন্সি-কে ২টি উত্তর পাঠানো হয়েছে।',
  },
  {
    name: 'some answers changed',
    setup: () =>
      mocks.confirmEvidenceAnswers.mockResolvedValue(confirmation({ sent: 2, changed: 1 })),
    data: () => form(answers(3)),
    en: `2 answers were sent to ${AGENCY}. 1 was not sent because your records changed after you opened this page. Check the list below and send again.`,
    bn: `${AGENCY}-কে ২টি উত্তর পাঠানো হয়েছে। এই পাতা খোলার পর আপনার রেকর্ড বদলে যাওয়ায় ১টি পাঠানো হয়নি। নিচের তালিকাটি দেখে আবার পাঠান।`,
  },
  {
    name: 'nothing went because the records changed',
    setup: () => mocks.confirmEvidenceAnswers.mockResolvedValue(confirmation({ changed: 2 })),
    data: () => form(answers(2)),
    en: 'Nothing was sent. Your records changed after you opened this page. Check the list and try again.',
    bn: 'কিছুই পাঠানো হয়নি। এই পাতা খোলার পর আপনার রেকর্ড বদলে গেছে। তালিকাটি দেখে আবার চেষ্টা করুন।',
  },
  {
    name: 'the page is out of date',
    setup: () =>
      mocks.confirmEvidenceAnswers.mockResolvedValue({
        ok: false,
        error: { code: 'not_found', message: 'x' },
      }),
    data: () => form(answers(1)),
    en: 'This page is out of date. Refresh it and choose again.',
    bn: 'এই পাতাটি পুরোনো হয়ে গেছে। রিফ্রেশ করে আবার বেছে নিন।',
  },
  {
    name: 'more answers than one step sends',
    setup: () => undefined,
    data: () => form(answers(26)),
    en: 'One step sends up to 25 answers. Untick some, send, then send the rest.',
    bn: 'এক ধাপে সর্বোচ্চ ২৫টি উত্তর পাঠানো যায়। কয়েকটির টিক তুলে দিয়ে পাঠান, তারপর বাকিগুলো পাঠান।',
  },
  {
    name: 'nothing was chosen',
    setup: () => undefined,
    data: () => form([]),
    en: 'Choose at least one answer to send.',
    bn: 'পাঠানোর জন্য অন্তত একটি উত্তর বেছে নিন।',
  },
  {
    name: 'something failed on our side',
    setup: () =>
      mocks.confirmEvidenceAnswers.mockResolvedValue({
        ok: false,
        error: { code: 'internal', message: 'select * from secrets' },
      }),
    data: () => form(answers(1)),
    en: 'Nothing was sent. Something went wrong on our side. Try again in a moment.',
    bn: 'কিছুই পাঠানো হয়নি। আমাদের দিকে কিছু একটা সমস্যা হয়েছে। একটু পরে আবার চেষ্টা করুন।',
  },
];

describe('what the send says back, in each language', () => {
  it.each(CASES)('$name', async ({ setup, data, en, bn }) => {
    setup();
    const english = await send('en', data());
    setup();
    const bengali = await send('bn', data());
    expect(english.message).toBe(en);
    expect(bengali.message).toBe(bn);
    // The language changes the words only: what happened is the same.
    expect({ ...bengali, message: '', savedAt: '' }).toEqual({
      ...english,
      message: '',
      savedAt: '',
    });
  });

  it('never shows a service sentence, in either language', async () => {
    mocks.confirmEvidenceAnswers.mockResolvedValue({
      ok: false,
      error: { code: 'internal', message: 'select * from secrets' },
    });
    for (const locale of ['en', 'bn'] as const)
      expect((await send(locale, form(answers(1)))).message).not.toContain('secrets');
  });
});

describe('coverage', () => {
  it('produced every Bengali sentence the action has', () => {
    expectEveryLiveMessageRendered(evidenceAnswerCatalog, 'evidenceAnswer.actions.');
  });
});
