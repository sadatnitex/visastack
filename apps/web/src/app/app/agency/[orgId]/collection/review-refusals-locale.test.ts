import { keyedError } from '@visastack/services';
import { type ServiceMessageKey, serviceMessages } from '@visastack/services/i18n';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The agency's review of an answer: the note refusals now carry keys, so the screen words them in
 * the visitor's language (checked Bangla where the register has it, the exact English otherwise).
 * Synthetic values only.
 */

const loc = vi.hoisted(() => ({ locale: 'en' as 'en' | 'bn' }));
const svc = vi.hoisted(() => ({
  agencyCollectionPrincipal: vi.fn(),
  recordCollectionReview: vi.fn(),
}));
vi.mock('../../../../../lib/locale', () => ({ getLocale: async () => loc.locale }));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  ...svc,
}));
vi.mock('../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => unknown) => fn({ db: {}, accountId: 'acct-1' }),
}));
vi.mock('../../../../../lib/server-error', () => ({ reportServerError: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { reviewAnswerAction } = await import('./collection-review-actions');

const BENGALI = /[ঀ-৿]/;
const bn = serviceMessages.bn as Readonly<Record<string, string>>;

const ROWS: readonly (readonly [
  ServiceMessageKey,
  Readonly<Record<string, number>> | undefined,
])[] = [
  ['umpe_collection_response_review.keep_the_note_to', { max: 1000 }],
  ['umpe_collection_response_review.keep_each_note_to', { max: 500 }],
  ['umpe_collection_response_review.choose_an_item_from_the_list', undefined],
  ['umpe_collection_response_review.too_many_notes_at_once', undefined],
];

function review() {
  const data = new FormData();
  data.set('organizationId', 'org-1');
  data.set('requestId', 'req-1');
  data.set('answerId', 'ans-1');
  data.set('decision', 'NEEDS_CORRECTION');
  return reviewAnswerAction({ ok: true, message: '' }, data);
}

beforeEach(() => {
  svc.agencyCollectionPrincipal.mockResolvedValue({ ok: true, value: {} });
  loc.locale = 'en';
});

describe('review note refusals in the visitor language', () => {
  it.each(ROWS)('en: %s shows the exact English', async (key, params) => {
    const error = keyedError('invalid', key, params);
    svc.recordCollectionReview.mockResolvedValue({ ok: false, error });
    expect(await review()).toEqual({ ok: false, message: error.message, field: 'decision' });
    expect(error.message).not.toContain('1,000');
  });

  it.each(ROWS)(
    'bn: %s shows the checked Bangla, or the English when there is none',
    async (key, params) => {
      loc.locale = 'bn';
      const error = keyedError('invalid', key, params);
      svc.recordCollectionReview.mockResolvedValue({ ok: false, error });
      const own = bn[key];
      const shown = await review();
      if (own === undefined) {
        expect(shown).toEqual({ ok: false, message: error.message, field: 'decision' });
      } else {
        expect(own).toMatch(BENGALI);
        expect(shown).toEqual({ ok: false, message: own, field: 'decision' });
      }
    },
  );
});
