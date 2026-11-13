import { keyedError } from '@visastack/services';
import { type ServiceMessageKey, serviceMessages } from '@visastack/services/i18n';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Saving a profile detail: the service's refusal in the visitor's language. Synthetic values. */

const loc = vi.hoisted(() => ({ locale: 'en' as 'en' | 'bn' }));
const mocks = vi.hoisted(() => ({ getApplicant: vi.fn(), editFact: vi.fn() }));
vi.mock('../../../../lib/locale', () => ({ getLocale: async () => loc.locale }));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  getApplicant: mocks.getApplicant,
  editFact: mocks.editFact,
  registerFieldDefinition: vi.fn(),
}));
vi.mock('../../../../lib/server-error', () => ({ reportServerError: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/server', () => ({ after: vi.fn() }));
vi.mock('../../../../lib/providers', () => ({ createKeyManagementPort: () => undefined }));
vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: { db: object; accountId: string }) => unknown) =>
    fn({ db: {}, accountId: 'owner-1' }),
}));

const { saveFactAction } = await import('./actions');

const BENGALI = /[ঀ-৿]/;
const bn = serviceMessages.bn as Readonly<Record<string, string>>;
const KEYS: readonly ServiceMessageKey[] = [
  'profile.applicant_not_found',
  'profile.core_processing_consent_is_required',
  'profile.enter_a_real_date',
];

function save() {
  const data = new FormData();
  data.set('applicantId', 'a-1');
  data.set('fieldKey', 'annual_income_tax_basis');
  data.set('value', 'Before tax');
  return saveFactAction({ ok: true, message: '' }, data);
}

beforeEach(() => {
  vi.clearAllMocks();
  loc.locale = 'en';
  mocks.getApplicant.mockResolvedValue({ id: 'a-1', ownerAccountId: 'owner-1' });
});

describe('saving a detail: service refusals in the visitor language', () => {
  it.each(KEYS)('en: %s is the exact English', async (key) => {
    const error = keyedError('invalid', key);
    mocks.editFact.mockResolvedValue({ ok: false, error });
    expect(await save()).toEqual({ ok: false, message: error.message });
  });

  it.each(KEYS)('bn: %s is the checked Bangla, or the English when there is none', async (key) => {
    loc.locale = 'bn';
    const error = keyedError('invalid', key);
    mocks.editFact.mockResolvedValue({ ok: false, error });
    const own = bn[key];
    if (own !== undefined) expect(own).toMatch(BENGALI);
    expect(await save()).toEqual({ ok: false, message: own ?? error.message });
  });
});
