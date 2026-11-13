'use server';

import {
  endGuestSession,
  removeGuestFile,
  saveGuestRetentionChoice,
  sendGuestCode,
  setGuestFileItem,
  submitGuestDocuments,
  verifyGuestCode,
} from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createKeyManagementPort } from '../../lib/providers';
import { withPublicDb } from '../../lib/public-db';
import { sendEmailNow } from '../../lib/send-now';
import { reportServerError } from '../../lib/server-error';
import { serviceErrorMessage, serviceKeyMessage } from '../../lib/service-error-message';
import { createStorage } from '../../lib/storage';
import {
  COLLECT_COOKIE,
  COLLECT_COOKIE_OPTIONS,
  COLLECT_COOKIE_SECONDS,
  collectSwitchOn,
  networkSubject,
  sessionProofFrom,
} from './load';

/**
 * The guest desk's actions (UMPE P8). Each one reads the desk session from its httpOnly cookie and
 * hands the services only that proof; the services re-check, live, that the session and its link
 * are open. A closed session gets the same answer whatever the reason. Server actions refuse a
 * cross-site post, and the cookie is SameSite=Lax.
 */

export interface GuestActionState {
  readonly ok: boolean;
  readonly message: string;
  readonly field?: string;
}

const CLOSED: GuestActionState = {
  ok: false,
  message: 'This page has closed. Open the link from your message again.',
};

const BUSY_CODE: GuestActionState = {
  ok: false,
  message: 'Too many codes were asked for just now. Try again in an hour.',
};

async function proof() {
  if (!collectSwitchOn()) return null;
  return sessionProofFrom((await cookies()).get(COLLECT_COOKIE)?.value);
}

/** Email a new six-digit code to the address the agency entered for this link. */
export async function sendCodeAction(
  _prev: GuestActionState,
  _formData: FormData,
): Promise<GuestActionState> {
  const session = await proof();
  if (!session) return CLOSED;
  const encryption = createKeyManagementPort();
  if (!encryption) {
    return { ok: false, message: 'Codes cannot be sent right now. Ask the agency for help.' };
  }
  const subject = networkSubject(await headers());
  let codeId: string | null = null;
  try {
    const result = await withPublicDb((db) =>
      sendGuestCode(db, session, { encryption, networkSubject: subject }),
    );
    if (!result.ok) {
      if (result.error.code === 'rate_limited') return BUSY_CODE;
      if (result.error.code === 'invalid') {
        return { ok: false, message: await serviceErrorMessage(result.error) };
      }
      return CLOSED;
    }
    if ('codeId' in result.value) codeId = result.value.codeId;
  } catch (error) {
    reportServerError('guestCollectionCode', error, { step: 'send failed' });
    return { ok: false, message: 'The code could not be sent. Try again in a minute.' };
  }
  if (codeId) {
    // Only this code's email, while the guest waits; a failed try is retried by the regular worker.
    const outcome = await sendEmailNow(codeId);
    if (outcome === 'failed') {
      return { ok: false, message: 'The code could not be sent. Ask the agency for help.' };
    }
  }
  redirect('/collect?step=guest&sent=1');
}

/** Check the code. Right: the session gets a new id and the checklist opens. */
export async function verifyCodeAction(
  _prev: GuestActionState,
  formData: FormData,
): Promise<GuestActionState> {
  const session = await proof();
  if (!session) return CLOSED;
  const code = formData.get('code');
  if (typeof code !== 'string' || code.trim().length === 0) {
    return { ok: false, message: 'Enter the six-digit code from the email.', field: 'code' };
  }
  const subject = networkSubject(await headers());
  let rotated: string;
  try {
    const result = await withPublicDb((db) =>
      verifyGuestCode(db, session, { code, networkSubject: subject }),
    );
    if (!result.ok) {
      const error = result.error;
      if (error.code === 'wrong') {
        return { ok: false, message: await serviceErrorMessage(error), field: 'code' };
      }
      if (error.code === 'expired') return { ok: false, message: await serviceErrorMessage(error) };
      if (error.code === 'rate_limited') {
        return { ok: false, message: 'Too many tries just now. Try again in an hour.' };
      }
      return CLOSED;
    }
    rotated = result.value.rawSessionId;
  } catch (error) {
    reportServerError('guestCollectionCode', error, { step: 'verify failed' });
    return { ok: false, message: 'The code could not be checked. Try again in a minute.' };
  }
  (await cookies()).set(COLLECT_COOKIE, rotated, {
    ...COLLECT_COOKIE_OPTIONS,
    maxAge: COLLECT_COOKIE_SECONDS,
  });
  redirect('/collect');
}

/** Store how long the agency may keep the files after the request closes. */
export async function retentionAction(
  _prev: GuestActionState,
  formData: FormData,
): Promise<GuestActionState> {
  const session = await proof();
  if (!session) return CLOSED;
  const days = Number(formData.get('retentionDays'));
  if (!Number.isInteger(days)) {
    // The service's own words for this check, so both say the same thing in every language.
    return {
      ok: false,
      message: await serviceKeyMessage('umpe_guest_collection.choose_how_long_the_agency_may'),
      field: 'retentionDays',
    };
  }
  try {
    const result = await withPublicDb((db) => saveGuestRetentionChoice(db, session, days));
    if (!result.ok) {
      return result.error.code === 'invalid'
        ? { ok: false, message: await serviceErrorMessage(result.error), field: 'retentionDays' }
        : CLOSED;
    }
    revalidatePath('/collect');
    return {
      ok: true,
      message: `Saved. The agency may keep your files for ${result.value.retentionDays} days after the request closes.`,
    };
  } catch (error) {
    reportServerError('guestCollectionRetention', error, { step: 'save failed' });
    return { ok: false, message: 'Your choice could not be saved. Try again in a minute.' };
  }
}

/** Leave: this device's session ends. */
export async function leaveAction(
  _prev: GuestActionState,
  _formData: FormData,
): Promise<GuestActionState> {
  const session = await proof();
  if (session) {
    try {
      await withPublicDb((db) => endGuestSession(db, session));
    } catch (error) {
      reportServerError('guestCollectionSession', error, { step: 'end failed' });
      return { ok: false, message: 'Could not leave just now. Try again in a minute.' };
    }
  }
  (await cookies()).set(COLLECT_COOKIE, '', { ...COLLECT_COOKIE_OPTIONS, maxAge: 0 });
  redirect('/collect?left=1');
}

// --- UMPE P9: files and Submit Documents ---------------------------------------------------------

/** Put one file under an issued item, or under none. The guest's choice replaces a proposal. */
export async function placeFileAction(
  _prev: GuestActionState,
  formData: FormData,
): Promise<GuestActionState> {
  const session = await proof();
  if (!session) return CLOSED;
  try {
    const result = await withPublicDb((db) =>
      setGuestFileItem(db, session, {
        fileId: formData.get('fileId'),
        itemId: formData.get('itemId'),
      }),
    );
    if (!result.ok) {
      return result.error.code === 'invalid'
        ? { ok: false, message: await serviceErrorMessage(result.error), field: 'itemId' }
        : CLOSED;
    }
    revalidatePath('/collect');
    return { ok: true, message: result.value.itemId ? 'Saved.' : 'Saved as not placed.' };
  } catch (error) {
    reportServerError('guestCollectionFiles', error, { step: 'place failed' });
    return { ok: false, message: 'This could not be saved. Try again in a minute.' };
  }
}

/** Remove one file from the list (a file already sent stays with what was sent). */
export async function removeFileAction(
  _prev: GuestActionState,
  formData: FormData,
): Promise<GuestActionState> {
  const session = await proof();
  if (!session) return CLOSED;
  try {
    const result = await withPublicDb((db) =>
      removeGuestFile(db, createStorage(db), session, formData.get('fileId')),
    );
    if (!result.ok) return CLOSED;
    revalidatePath('/collect');
    return {
      ok: true,
      message: result.value.kept
        ? 'Removed from your list. The copy you already sent stays with what you sent.'
        : 'Removed.',
    };
  } catch (error) {
    reportServerError('guestCollectionFiles', error, { step: 'remove failed' });
    return { ok: false, message: 'This file could not be removed. Try again in a minute.' };
  }
}

/** Submit Documents: send exactly the files placed under the checklist items. */
export async function submitDocumentsAction(
  _prev: GuestActionState,
  formData: FormData,
): Promise<GuestActionState> {
  const session = await proof();
  if (!session) return CLOSED;
  if (formData.get('consent') !== 'yes') {
    return {
      ok: false,
      message: await serviceKeyMessage('umpe_guest_uploads.tick_the_box_to_confirm_what'),
      field: 'consent',
    };
  }
  try {
    const result = await withPublicDb((db) => submitGuestDocuments(db, session, { consent: true }));
    if (!result.ok) {
      if (result.error.code === 'rate_limited') {
        return {
          ok: false,
          message: 'You sent documents several times just now. Try again later.',
        };
      }
      return result.error.code === 'invalid' || result.error.code === 'stale'
        ? { ok: false, message: await serviceErrorMessage(result.error) }
        : CLOSED;
    }
    revalidatePath('/collect');
    const { files, stillMissing } = result.value;
    return {
      ok: true,
      message: `Sent ${files} ${files === 1 ? 'file' : 'files'} to the agency${stillMissing > 0 ? `, with ${stillMissing} ${stillMissing === 1 ? 'item' : 'items'} still missing` : ''}.`,
    };
  } catch (error) {
    reportServerError('guestCollectionSubmit', error, { step: 'submit failed' });
    return { ok: false, message: 'Your documents could not be sent. Try again in a minute.' };
  }
}
