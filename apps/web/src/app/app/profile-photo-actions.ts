'use server';

import {
  PROFILE_PHOTO_MAX_INPUT_BYTES,
  applicantPhotoPath,
  removeApplicantPhoto,
  setApplicantPhoto,
} from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { photoAccess, profilePhotoPorts } from '../../lib/profile-photos';
import { withSession } from '../../lib/session';
import { createStorage } from '../../lib/storage';

export interface ProfilePhotoResult {
  readonly ok: boolean;
  readonly message: string;
  /** The new photo address after a successful save; null after a removal. */
  readonly photoUrl?: string | null;
}

const NOT_ALLOWED: ProfilePhotoResult = {
  ok: false,
  message: 'Only the owner of this profile can change its photo.',
};

/** Add or replace a traveller's profile photo (WP-PH1). The browser sends its cropped square JPEG. */
export async function saveProfilePhotoAction(formData: FormData): Promise<ProfilePhotoResult> {
  const applicantId = String(formData.get('applicantId') ?? '');
  const file = formData.get('photo');
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: 'Choose a photo first.' };
  }
  if (file.size > PROFILE_PHOTO_MAX_INPUT_BYTES) {
    return { ok: false, message: 'Choose a photo smaller than 5 MB.' };
  }
  const result = await withSession(async ({ db, accountId }) => {
    const access = await photoAccess(db, accountId, applicantId, 'MANAGE');
    if (!access) return NOT_ALLOWED;
    const saved = await setApplicantPhoto(access, profilePhotoPorts(db), {
      contentType: file.type,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    if (!saved.ok) return { ok: false, message: saved.error.message };
    return {
      ok: true,
      message: 'Photo saved.',
      photoUrl: applicantPhotoPath(applicantId, saved.value.version),
    };
  });
  if (result.ok) revalidatePath('/app', 'layout');
  return result;
}

/** Remove a traveller's profile photo (WP-PH1). Initials show again everywhere it appeared. */
export async function removeProfilePhotoAction(formData: FormData): Promise<ProfilePhotoResult> {
  const applicantId = String(formData.get('applicantId') ?? '');
  const result = await withSession(async ({ db, accountId }) => {
    const access = await photoAccess(db, accountId, applicantId, 'MANAGE');
    if (!access) return NOT_ALLOWED;
    const removed = await removeApplicantPhoto(access, createStorage(db));
    if (!removed.ok) return { ok: false, message: removed.error.message };
    return { ok: true, message: 'Photo removed.', photoUrl: null };
  });
  if (result.ok) revalidatePath('/app', 'layout');
  return result;
}
