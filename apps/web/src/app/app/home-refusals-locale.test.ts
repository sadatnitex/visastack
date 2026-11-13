import { type ServiceError, keyedError, serviceError } from '@visastack/services';
import { type ServiceMessageKey, serviceMessages } from '@visastack/services/i18n';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Home's add-a-person and consent refusals in the visitor's language: the service's words go
 * through the services message list. Synthetic values only.
 */

const loc = vi.hoisted(() => ({ locale: 'en' as 'en' | 'bn' }));
const svc = vi.hoisted(() => ({ setConsent: vi.fn(), createApplicant: vi.fn() }));
vi.mock('../../lib/locale', () => ({ getLocale: async () => loc.locale }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'me@example.test' }),
}));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  ...svc,
}));

const { createApplicantAction, setConsentAction } = await import('./actions');

const BENGALI = /[ঀ-৿]/;
const INITIAL = { ok: true, message: '' };
const bn = serviceMessages.bn as Readonly<Record<string, string>>;

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

const refused = (error: ServiceError) => ({ ok: false, error });

const KEYS: readonly (readonly [ServiceMessageKey, ServiceError['code']])[] = [
  ['applicants.applicants_may_only_be_created_by', 'forbidden'],
  ['applicants.a_display_name_is_required', 'invalid'],
  ['applicants.core_processing_consent_is_required_before', 'consent_required'],
  ['applicants.confirm_you_have_authority_to_create', 'invalid'],
];

const addSelf = () =>
  createApplicantAction(INITIAL, form({ whoFor: 'SELF', displayName: 'Example Traveller' }));

beforeEach(() => {
  svc.setConsent.mockReset();
  svc.createApplicant.mockReset();
  loc.locale = 'en';
});

describe('add a person: the service refusal in the visitor language', () => {
  it.each(KEYS)('en: %s shows the exact English', async (key, code) => {
    const error = keyedError(code, key);
    svc.createApplicant.mockResolvedValue(refused(error));
    expect(await addSelf()).toEqual({ ok: false, message: error.message });
  });

  it.each(KEYS)('bn: %s shows the checked Bangla', async (key, code) => {
    loc.locale = 'bn';
    svc.createApplicant.mockResolvedValue(refused(keyedError(code, key)));
    expect(bn[key]).toMatch(BENGALI);
    expect(await addSelf()).toEqual({ ok: false, message: bn[key] });
  });
});

describe('consent: the service refusal', () => {
  it('a keyed refusal is worded in the visitor language', async () => {
    const key = 'missions.core_processing_consent_is_required';
    svc.setConsent.mockResolvedValue(refused(keyedError('consent_required', key)));
    const run = () => setConsentAction(INITIAL, form({ type: 'CORE_PROCESSING', granted: 'true' }));
    expect(await run()).toEqual({ ok: false, message: serviceMessages.en[key] });
    loc.locale = 'bn';
    expect(bn[key]).toMatch(BENGALI);
    expect(await run()).toEqual({ ok: false, message: bn[key] });
  });

  it('the unkeyed owner-only refusal keeps its English under bn', async () => {
    loc.locale = 'bn';
    const english = 'consent may only be changed by the account owner';
    svc.setConsent.mockResolvedValue(refused(serviceError('forbidden', english)));
    expect(
      await setConsentAction(INITIAL, form({ type: 'CORE_PROCESSING', granted: 'true' })),
    ).toEqual({ ok: false, message: english });
  });
});
