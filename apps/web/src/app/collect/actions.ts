'use server';

import {
  endGuestSession,
  saveGuestRetentionChoice,
  sendGuestCode,
  verifyGuestCode,
} from '@visastack/services';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { triggerNotificationWorker } from '../../lib/jobs';
import { createKeyManagementPort } from '../../lib/providers';
import { withPublicDb } from '../../lib/public-db';
import { sendEmailNow } from '../../lib/send-now';
import { reportServerError } from '../../lib/server-error';
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
      if (result.error.code === 'invalid') return { ok: false, message: result.error.message };
      return CLOSED;
    }
    if ('codeId' in result.value) codeId = result.value.codeId;
  } catch (error) {
    reportServerError('guestCollectionCode', error, { step: 'send failed' });
    return { ok: false, message: 'The code could not be sent. Try again in a minute.' };
  }
  if (codeId) {
    const outcome = await sendEmailNow(codeId);
    after(() => triggerNotificationWorker().then(() => undefined));
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
      if (error.code === 'wrong') return { ok: false, message: error.message, field: 'code' };
      if (error.code === 'expired') return { ok: false, message: error.message };
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
    return {
      ok: false,
      message: 'Choose how long the agency may keep your files.',
      field: 'retentionDays',
    };
  }
  try {
    const result = await withPublicDb((db) => saveGuestRetentionChoice(db, session, days));
    if (!result.ok) {
      return result.error.code === 'invalid'
        ? { ok: false, message: result.error.message, field: 'retentionDays' }
        : CLOSED;
    }
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
