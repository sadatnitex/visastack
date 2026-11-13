import { keyedError } from '@visastack/services';
import { type ServiceMessageKey, serviceMessages } from '@visastack/services/i18n';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The request screen's refusals in the visitor's language: a question about an item and an answer
 * the service refuses for another reason than the ones the screen words itself. Synthetic values.
 */

const loc = vi.hoisted(() => ({ locale: 'en' as 'en' | 'bn' }));
const mocks = vi.hoisted(() => ({
  submitEvidenceResponse: vi.fn(),
  askAboutRequestItem: vi.fn(),
  requireAccess: vi.fn(),
}));
vi.mock('../../../../../lib/locale', () => ({ getLocale: async () => loc.locale }));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  ...mocks,
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/server', () => ({ after: vi.fn() }));
vi.mock('../../../../../lib/jobs', () => ({ triggerNotificationWorker: vi.fn() }));
vi.mock('../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) => fn({ db: {}, accountId: 'owner' }),
}));

const { askAboutRequestItemAction, submitEvidenceResponseAction } = await import('./actions');

const BENGALI = /[ঀ-৿]/;
const PREV = { ok: true, message: '' };
const bn = serviceMessages.bn as Readonly<Record<string, string>>;
const form = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};

const ASK: readonly (readonly [ServiceMessageKey, Readonly<Record<string, number>> | undefined])[] =
  [
    ['request_items.only_the_owner_of_this_record', undefined],
    ['request_items.write_your_question_first', undefined],
    ['request_items.keep_your_question_under', { max: 500 }],
    ['request_items.request_not_found', undefined],
    ['request_items.this_request_cannot_take_a_question', undefined],
    ['request_items.you_have_asked_several_questions', undefined],
  ];
const SUBMIT: readonly ServiceMessageKey[] = [
  'agency.this_was_already_sent_and_has',
  'agency.choosing_an_exact_saved_value_is',
];

const ask = () =>
  askAboutRequestItemAction(
    PREV,
    form({ applicantId: 'a1', missionId: 'm1', requestId: 'r1', question: 'Which page?' }),
  );
const submit = () =>
  submitEvidenceResponseAction(PREV, form({ applicantId: 'a1', requestId: 'r1', factId: 'f1' }));

/** What the visitor should read: the checked Bangla under bn when it exists, else the English. */
function expected(key: ServiceMessageKey, params?: Readonly<Record<string, number>>): string {
  const english = keyedError('invalid', key, params).message;
  const own = bn[key];
  if (loc.locale !== 'bn' || own === undefined) return english;
  expect(own).toMatch(BENGALI);
  return own;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAccess.mockResolvedValue({ ok: true, value: { applicant: { id: 'a1' } } });
});

describe.each(['en', 'bn'] as const)('request screen refusals under %s', (locale) => {
  beforeEach(() => {
    loc.locale = locale;
  });

  it.each(ASK)('ask a question: %s', async (key, params) => {
    mocks.askAboutRequestItem.mockResolvedValue({
      ok: false,
      error: keyedError('invalid', key, params),
    });
    const shown = await ask();
    expect(shown).toEqual({ ok: false, message: expected(key, params) });
    if (locale === 'bn' && params === undefined && bn[key] === undefined) {
      expect(shown.message).toBe(serviceMessages.en[key]);
    }
  });

  it.each(SUBMIT)('send an answer: %s', async (key) => {
    mocks.submitEvidenceResponse.mockResolvedValue({ ok: false, error: keyedError('stale', key) });
    expect(await submit()).toEqual({ ok: false, message: expected(key) });
  });

  it('the answers the screen words itself stay as they were', async () => {
    mocks.submitEvidenceResponse.mockResolvedValue({
      ok: false,
      error: keyedError('invalid', 'agency.this_request_is_not_awaiting_a'),
    });
    expect((await submit()).message).toBe(
      'This request is no longer waiting for you. Refresh the page to see where it stands.',
    );
  });
});
