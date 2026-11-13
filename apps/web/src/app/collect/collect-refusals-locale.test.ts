import { keyedError } from '@visastack/services';
import { type ServiceMessageKey, serviceMessages } from '@visastack/services/i18n';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The guest desk's refusals in the visitor's language: every place the actions show a service's
 * words goes through the services message list, so a Bangla visitor reads the checked Bangla and
 * an English visitor reads exactly the English the service always sent. Synthetic values only.
 */

const loc = vi.hoisted(() => ({ locale: 'en' as 'en' | 'bn' }));
const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  verify: vi.fn(),
  retain: vi.fn(),
  place: vi.fn(),
  submit: vi.fn(),
}));

vi.mock('../../lib/locale', () => ({ getLocale: async () => loc.locale }));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  sendGuestCode: mocks.send,
  verifyGuestCode: mocks.verify,
  saveGuestRetentionChoice: mocks.retain,
  setGuestFileItem: mocks.place,
  submitGuestDocuments: mocks.submit,
}));
vi.mock('../../lib/public-db', () => ({
  withPublicDb: async (fn: (db: unknown) => Promise<unknown>) => fn({}),
}));
vi.mock('../../lib/providers', () => ({ createKeyManagementPort: () => ({}) }));
vi.mock('../../lib/send-now', () => ({ sendEmailNow: async () => 'sent' }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-forwarded-for': '203.0.113.9' }),
  cookies: async () => ({
    get: (name: string) => (name === 'vs_collect' ? { value: 'S'.repeat(43) } : undefined),
    set: () => undefined,
  }),
}));

const actions = await import('./actions');

const BENGALI = /[ঀ-৿]/;
const INITIAL = { ok: true, message: '' };
const bn = serviceMessages.bn as Readonly<Record<string, string>>;

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

/** A guest code refusal as the service returns it: its own code, the keyed words. */
function codeRefusal(code: 'wrong' | 'expired', key: ServiceMessageKey, left?: number) {
  const { message, messageKey, params } = keyedError(
    'invalid',
    key,
    left === undefined ? undefined : { left },
  );
  return { code, message, messageKey, ...(params ? { params } : {}) };
}

interface Row {
  readonly name: string;
  readonly key: ServiceMessageKey;
  readonly params?: { readonly left: number };
  readonly field?: string;
  /** Sets the service's answer and runs the action. */
  readonly run: () => Promise<{ ok: boolean; message: string; field?: string }>;
}

const ROWS: readonly Row[] = [
  ...(
    [
      'umpe_guest_collection.this_request_has_no_email_address',
      'umpe_guest_collection.this_link_can_no_longer_be',
    ] as const
  ).map(
    (key): Row => ({
      name: `send code: ${key}`,
      key,
      run: async () => {
        mocks.send.mockResolvedValue({ ok: false, error: keyedError('invalid', key) });
        return actions.sendCodeAction(INITIAL, form({}));
      },
    }),
  ),
  ...(
    [
      ['wrong', 'umpe_guest_collection.enter_the_six_digits_from_the', undefined],
      ['wrong', 'umpe_guest_collection.that_code_is_not_right', 2],
      ['wrong', 'umpe_guest_collection.that_code_is_not_right', 1],
      ['expired', 'umpe_guest_collection.this_link_can_no_longer_be', undefined],
      ['expired', 'umpe_guest_collection.this_code_has_expired_or_was', undefined],
      ['expired', 'umpe_guest_collection.that_code_has_had_too_many', undefined],
    ] as const
  ).map(
    ([code, key, left]): Row => ({
      name: `check code (${code}${left === undefined ? '' : `, ${left} left`}): ${key}`,
      key,
      ...(left === undefined ? {} : { params: { left } }),
      ...(code === 'wrong' ? { field: 'code' } : {}),
      run: async () => {
        mocks.verify.mockResolvedValue({ ok: false, error: codeRefusal(code, key, left) });
        return actions.verifyCodeAction(INITIAL, form({ code: '000000' }));
      },
    }),
  ),
  {
    name: 'keep files: the service refuses the choice',
    key: 'umpe_guest_collection.choose_how_long_the_agency_may',
    field: 'retentionDays',
    run: async () => {
      mocks.retain.mockResolvedValue({
        ok: false,
        error: keyedError('invalid', 'umpe_guest_collection.choose_how_long_the_agency_may'),
      });
      return actions.retentionAction(INITIAL, form({ retentionDays: '30' }));
    },
  },
  {
    name: 'keep files: a made-up choice gets the same answer before the service is asked',
    key: 'umpe_guest_collection.choose_how_long_the_agency_may',
    field: 'retentionDays',
    run: async () => actions.retentionAction(INITIAL, form({ retentionDays: 'forever' })),
  },
  {
    name: 'place a file',
    key: 'umpe_guest_uploads.choose_an_item_from_the_list',
    field: 'itemId',
    run: async () => {
      mocks.place.mockResolvedValue({
        ok: false,
        error: keyedError('invalid', 'umpe_guest_uploads.choose_an_item_from_the_list'),
      });
      return actions.placeFileAction(INITIAL, form({ fileId: 'f', itemId: 'i' }));
    },
  },
  ...(
    [
      ['invalid', 'umpe_guest_uploads.this_checklist_cannot_be_used_right'],
      ['invalid', 'umpe_guest_uploads.wait_until_every_file_has_been'],
      ['invalid', 'umpe_guest_uploads.place_at_least_one_file_under'],
      ['stale', 'umpe_guest_uploads.your_documents_were_just_sent_reload'],
    ] as const
  ).map(
    ([code, key]): Row => ({
      name: `send documents (${code}): ${key}`,
      key,
      run: async () => {
        mocks.submit.mockResolvedValue({ ok: false, error: keyedError(code, key) });
        return actions.submitDocumentsAction(INITIAL, form({ consent: 'yes' }));
      },
    }),
  ),
];

beforeEach(() => {
  vi.stubEnv('AGENCY_COLLECTION_REQUESTS', 'true');
  for (const fn of Object.values(mocks)) fn.mockReset();
  loc.locale = 'en';
});

describe('guest desk refusals in the visitor language', () => {
  it.each(ROWS)('en: $name shows the exact English', async (row) => {
    const state = await row.run();
    expect(state.ok).toBe(false);
    expect(state.message).toBe(keyedError('invalid', row.key, row.params).message);
    expect(state.field).toBe(row.field);
  });

  it.each(ROWS)(
    'bn: $name shows the checked Bangla, or the English when there is none',
    async (row) => {
      loc.locale = 'bn';
      const state = await row.run();
      const english = keyedError('invalid', row.key, row.params).message;
      const own = bn[row.key];
      if (own === undefined) {
        expect(state.message).toBe(english);
      } else {
        expect(state.message).toMatch(BENGALI);
        expect(state.message).not.toContain(row.key);
        if (row.params === undefined) expect(state.message).toBe(own);
      }
      expect(state.field).toBe(row.field);
    },
  );

  it('the wrong-code count stays English, with its exact count, until a draft exists', async () => {
    loc.locale = 'bn';
    mocks.verify.mockResolvedValue({
      ok: false,
      error: codeRefusal('wrong', 'umpe_guest_collection.that_code_is_not_right', 3),
    });
    const state = await actions.verifyCodeAction(INITIAL, form({ code: '000000' }));
    expect(state.message).toBe(
      'That code is not right. Check the newest email and try again (3 tries left).',
    );
  });
});
