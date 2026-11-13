import { keyedError } from '@visastack/services';
import { serviceMessages } from '@visastack/services/i18n';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Every refusal the photo service can send to the photo screen, in the visitor's language
 * (table-driven). The screen's own early checks (no file, too large, not the owner) are worded on
 * the screen and are not service refusals.
 */

const state = vi.hoisted(() => ({ locale: 'en' as 'en' | 'bn', key: '' }));
vi.mock('../../lib/locale', () => ({ getLocale: async () => state.locale }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  unstable_rethrow: (error: unknown) => {
    throw error;
  },
}));
vi.mock('@visastack/services', async (importOriginal) => {
  const real = await importOriginal<typeof import('@visastack/services')>();
  const refuse = async () => ({ ok: false, error: real.keyedError('invalid', state.key as never) });
  return { ...real, setApplicantPhoto: refuse, removeApplicantPhoto: refuse };
});
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

const BENGALI = /[ঀ-৿]/;
const en = serviceMessages.en as Record<string, string>;
const bn = serviceMessages.bn as Record<string, string>;

// The refusals setApplicantPhoto and removeApplicantPhoto give, each with checked Bangla.
const PHOTO_KEYS = [
  'photos.accessDenied',
  'photos.chooseAJpegOrPngPhoto',
  'photos.chooseAPhotoSmallerThan5',
  'photos.onlyTheOwnerOfThisProfile',
  'photos.photosAreNotAvailableYetPlease',
  'photos.thePhotoDidNotSaveCorrectly',
  'photos.thePhotoDidNotUploadCorrectly',
  'photos.thisFileIsNotTheKind',
  'photos.thisPhotoCouldNotBeRead',
  'photos.thisPhotoDidNotPassThe',
  'photos.tooManyPhotoChangesInA',
] as const;

function saveForm() {
  const form = new FormData();
  form.set('applicantId', 'ap-1');
  form.set('photo', new File([new Uint8Array([1, 2, 3])], 'p.jpg', { type: 'image/jpeg' }));
  return form;
}
function removeForm() {
  const form = new FormData();
  form.set('applicantId', 'ap-1');
  return form;
}

beforeEach(() => {
  state.locale = 'en';
});

describe('the photo screen words each refusal in the visitor language', () => {
  it.each(PHOTO_KEYS)('%s: the exact English under en, the Bangla under bn', async (key) => {
    state.key = key;
    expect(bn[key]).toMatch(BENGALI);
    expect((await saveProfilePhotoAction(saveForm())).message).toBe(en[key]);
    expect((await removeProfilePhotoAction(removeForm())).message).toBe(en[key]);
    expect(keyedError('invalid', key).message).toBe(en[key]);
    state.locale = 'bn';
    expect((await saveProfilePhotoAction(saveForm())).message).toBe(bn[key]);
    expect((await removeProfilePhotoAction(removeForm())).message).toBe(bn[key]);
  });
});

describe('the photo-size check made before the service is asked', () => {
  const tooLarge = () => {
    const data = new FormData();
    data.set('applicantId', 'ap-1');
    data.set(
      'photo',
      new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.jpg', { type: 'image/jpeg' }),
    );
    return data;
  };

  it('says the service own words: exact English under en, the checked Bangla under bn', async () => {
    state.locale = 'en';
    expect(await saveProfilePhotoAction(tooLarge())).toEqual({
      ok: false,
      message: 'Choose a photo smaller than 5 MB.',
    });
    state.locale = 'bn';
    expect(bn['photos.chooseAPhotoSmallerThan5']).toMatch(BENGALI);
    expect(await saveProfilePhotoAction(tooLarge())).toEqual({
      ok: false,
      message: bn['photos.chooseAPhotoSmallerThan5'],
    });
  });

  it('the other early checks stay English until a matching draft exists', async () => {
    state.locale = 'bn';
    const empty = new FormData();
    empty.set('applicantId', 'ap-1');
    expect(await saveProfilePhotoAction(empty)).toEqual({
      ok: false,
      message: 'Choose a photo first.',
    });
  });
});
