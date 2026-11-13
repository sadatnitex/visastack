import { keyedError } from '@visastack/services';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ locale: 'en' as 'en' | 'bn' }));
vi.mock('../../lib/locale', () => ({ getLocale: async () => state.locale }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  unstable_rethrow: (error: unknown) => {
    throw error;
  },
}));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  setApplicantPhoto: async () => ({
    ok: false,
    error: keyedError('consent_required', 'documents.coreProcessingConsentIsRequired'),
  }),
  removeApplicantPhoto: async () => ({
    ok: false,
    error: keyedError('consent_required', 'documents.coreProcessingConsentIsRequired'),
  }),
}));
vi.mock('../../lib/profile-photos', () => ({
  photoAccess: async () => ({ access: true }),
  profilePhotoPorts: () => ({}),
}));
vi.mock('../../lib/storage', () => ({ createStorage: () => ({}) }));
vi.mock('../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) => fn({ db: {}, accountId: 'a-1' }),
}));

const { removeProfilePhotoAction, saveProfilePhotoAction } = await import(
  './profile-photo-actions'
);

const ENGLISH = 'Core processing consent is required';
const BENGALI = /[ঀ-৿]/;

function saveForm() {
  const form = new FormData();
  form.set('applicantId', 'ap-1');
  form.set('photo', new File([new Uint8Array([1, 2, 3])], 'p.jpg', { type: 'image/jpeg' }));
  return form;
}

beforeEach(() => {
  state.locale = 'en';
});

describe('profile photo refusals show in the visitor language', () => {
  it('saving: the exact English under en, the Bangla under bn', async () => {
    expect(await saveProfilePhotoAction(saveForm())).toEqual({ ok: false, message: ENGLISH });
    state.locale = 'bn';
    const shown = await saveProfilePhotoAction(saveForm());
    expect(shown.message).toMatch(BENGALI);
    expect(shown.message).not.toBe(ENGLISH);
  });

  it('removing: the exact English under en, the Bangla under bn', async () => {
    const form = new FormData();
    form.set('applicantId', 'ap-1');
    expect(await removeProfilePhotoAction(form)).toEqual({ ok: false, message: ENGLISH });
    state.locale = 'bn';
    expect((await removeProfilePhotoAction(form)).message).toMatch(BENGALI);
  });
});
