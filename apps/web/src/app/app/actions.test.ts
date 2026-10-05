import { beforeEach, describe, expect, it, vi } from 'vitest';
import { localeState } from '../../lib/next-mocks.test-support';

const mocks = vi.hoisted(() => ({ setConsent: vi.fn(), createApplicant: vi.fn() }));

vi.mock('@visastack/services', () => mocks);
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'traveller@example.com' }),
}));

const { createApplicantAction, setConsentAction } = await import('./actions');

const INITIAL = { ok: true, message: '' };

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  localeState.value = 'en';
  mocks.setConsent.mockResolvedValue({ ok: true, value: undefined });
  mocks.createApplicant.mockResolvedValue({ ok: true, value: { id: 'a1' } });
});

describe('setConsentAction', () => {
  it('confirms in English as it always has', async () => {
    expect(await setConsentAction(INITIAL, form({ type: 'MARKETING', granted: 'true' }))).toEqual({
      ok: true,
      message: 'Consent granted.',
    });
    expect(await setConsentAction(INITIAL, form({ type: 'MARKETING', granted: 'false' }))).toEqual({
      ok: true,
      message: 'Consent revoked.',
    });
  });

  it('confirms in Bangla for a Bangla reader', async () => {
    localeState.value = 'bn';
    expect(await setConsentAction(INITIAL, form({ type: 'MARKETING', granted: 'true' }))).toEqual({
      ok: true,
      message: 'সম্মতি দেওয়া হয়েছে।',
    });
    expect(await setConsentAction(INITIAL, form({ type: 'MARKETING', granted: 'false' }))).toEqual({
      ok: true,
      message: 'সম্মতি প্রত্যাহার করা হয়েছে।',
    });
  });

  it('refuses an unknown consent type in the readers language', async () => {
    localeState.value = 'bn';
    expect(await setConsentAction(INITIAL, form({ type: 'NOPE', granted: 'true' }))).toEqual({
      ok: false,
      message: 'অজানা সম্মতির ধরন।',
    });
    expect(mocks.setConsent).not.toHaveBeenCalled();
  });

  it('shows the service wording in English and the plain Bangla message otherwise', async () => {
    mocks.setConsent.mockResolvedValue({
      ok: false,
      error: { code: 'forbidden', message: 'consent may only be changed by the account owner' },
    });
    expect(await setConsentAction(INITIAL, form({ type: 'MARKETING', granted: 'true' }))).toEqual({
      ok: false,
      message: 'consent may only be changed by the account owner',
    });
    localeState.value = 'bn';
    expect(await setConsentAction(INITIAL, form({ type: 'MARKETING', granted: 'true' }))).toEqual({
      ok: false,
      message: 'এটি করার অনুমতি আপনার নেই।',
    });
  });
});

describe('createApplicantAction', () => {
  it('asks for a name, in the readers language', async () => {
    expect(await createApplicantAction(INITIAL, form({ displayName: '  ' }))).toEqual({
      ok: false,
      message: 'Enter a name.',
    });
    localeState.value = 'bn';
    expect(await createApplicantAction(INITIAL, form({ displayName: '' }))).toEqual({
      ok: false,
      message: 'একটি নাম লিখুন।',
    });
  });

  it('asks for the authority statement when the record is for someone else', async () => {
    localeState.value = 'bn';
    const result = await createApplicantAction(
      INITIAL,
      form({ displayName: 'Karim', relationship: 'FAMILY_MEMBER' }),
    );
    expect(result).toEqual({
      ok: false,
      message: 'এই রেকর্ড তৈরির অধিকার আপনার আছে, তা নিশ্চিত করুন।',
    });
    expect(mocks.createApplicant).not.toHaveBeenCalled();
  });

  it('stores a Bangla legal name exactly as typed and says so in Bangla', async () => {
    localeState.value = 'bn';
    // Joiners (ZWJ/ZWNJ) and a precomposed letter that canonical normalisation would split are
    // part of how a name is spelled; none of it may be changed on the way in.
    const typed = 'র‍্যাব রহিম‌ উদ্দিন য়';
    const result = await createApplicantAction(
      INITIAL,
      form({ displayName: `  ${typed}  `, relationship: 'SELF' }),
    );
    const stored = mocks.createApplicant.mock.calls[0]?.[1] as { displayName: string };
    expect([...stored.displayName].map((c) => c.codePointAt(0))).toEqual(
      [...typed].map((c) => c.codePointAt(0)),
    );
    expect(result).toEqual({ ok: true, message: `${typed} যোগ করা হয়েছে।` });
  });

  it('says it was added in English with the name as typed', async () => {
    const result = await createApplicantAction(
      INITIAL,
      form({ displayName: 'Karim Uddin', relationship: 'SELF' }),
    );
    expect(result).toEqual({ ok: true, message: 'Karim Uddin added.' });
  });

  it('reports a refusal as plain Bangla for a Bangla reader', async () => {
    mocks.createApplicant.mockResolvedValue({
      ok: false,
      error: { code: 'consent_required', message: 'core consent is required' },
    });
    localeState.value = 'bn';
    expect(
      await createApplicantAction(INITIAL, form({ displayName: 'রহিম', relationship: 'SELF' })),
    ).toEqual({ ok: false, message: 'চালিয়ে যাওয়ার আগে সম্মতি প্রয়োজন।' });
  });
});
