'use server';

import {
  confirmStaffFactorEnrolment,
  regenerateStaffRecoveryCodes,
  startStaffFactorEnrolment,
  verifyStaffFactor,
} from '@visastack/services';
import { redirect } from 'next/navigation';
import { bootstrapAdminEmails, holdsPlatformRole } from '../../../lib/admin';
import { neonReauthUrl, neonSessionRef, safeReturnPath } from '../../../lib/neon-recency';
import { createKeyManagementPort } from '../../../lib/providers';
import { withSession } from '../../../lib/session';
import { passwordIsRecent, staffCodeUrl } from '../../../lib/staff-factor';

/** What the setup and backup-code forms hand back to the screen. */
export interface StaffCodeState {
  readonly ok: boolean;
  readonly message: string;
  readonly field?: string;
  /** Shown once, never stored in readable form. */
  readonly recoveryCodes?: readonly string[];
}

const NOT_STAFF = '/app';

function returnToOf(formData: FormData): string {
  const raw = formData.get('returnTo');
  const path = safeReturnPath(typeof raw === 'string' ? raw : null);
  // Coming straight back here would only show this screen again.
  return path.startsWith('/app/staff-code') ? '/app/admin' : path;
}

function codeOf(formData: FormData): string {
  const raw = formData.get('code');
  return typeof raw === 'string' ? raw.trim().slice(0, 64) : '';
}

/** Begin setting up the app. Needs the password typed in the last five minutes. */
export async function startStaffEnrolmentAction(formData: FormData): Promise<void> {
  const returnTo = returnToOf(formData);
  const next = await withSession(async ({ db, accountId, email }) => {
    const actor = { accountId, email, bootstrapEmails: bootstrapAdminEmails() };
    if (!(await holdsPlatformRole(db, { accountId, email }))) return NOT_STAFF;
    if (!(await passwordIsRecent())) return neonReauthUrl(staffCodeUrl(returnTo));
    const port = createKeyManagementPort();
    if (!port) return `${staffCodeUrl(returnTo)}&e=nokey`;
    const sessionRef = await neonSessionRef();
    if (!sessionRef) return `${staffCodeUrl(returnTo)}&e=failed`;
    const started = await startStaffFactorEnrolment(db, port, {
      actor,
      sessionRef,
      stepUpSatisfied: true,
    });
    if (!started.ok) {
      return `${staffCodeUrl(returnTo)}&e=${started.error.code === 'invalid' ? 'active' : 'failed'}`;
    }
    return staffCodeUrl(returnTo);
  });
  redirect(next);
}

/** Finish setting up with the first code from the app. Returns the backup codes once. */
export async function confirmStaffEnrolmentAction(
  _prev: StaffCodeState,
  formData: FormData,
): Promise<StaffCodeState> {
  const code = codeOf(formData);
  if (code.length === 0) {
    return { ok: false, message: 'Enter the 6 digit code from your app.', field: 'code' };
  }
  return withSession(async ({ db, accountId, email }): Promise<StaffCodeState> => {
    if (!(await holdsPlatformRole(db, { accountId, email }))) {
      return { ok: false, message: 'This is only for platform staff.' };
    }
    const port = createKeyManagementPort();
    const sessionRef = await neonSessionRef();
    if (!port || !sessionRef) {
      return { ok: false, message: 'An authenticator app cannot be set up here yet.' };
    }
    const done = await confirmStaffFactorEnrolment(db, port, {
      actor: { accountId, email, bootstrapEmails: bootstrapAdminEmails() },
      code,
      sessionRef,
    });
    if (!done.ok) {
      return { ok: false, message: done.error.message, field: 'code' };
    }
    return {
      ok: true,
      message: 'Your authenticator app is set up. Save your backup codes now.',
      recoveryCodes: done.value.recoveryCodes,
    };
  });
}

/** Check a code (or a backup code) and carry on to where the person was going. */
export async function verifyStaffCodeAction(formData: FormData): Promise<void> {
  const returnTo = returnToOf(formData);
  const code = codeOf(formData);
  const back = staffCodeUrl(returnTo);
  if (code.length === 0) redirect(`${back}&e=empty`);
  const outcome = await withSession(async ({ db, accountId, email }) => {
    if (!(await holdsPlatformRole(db, { accountId, email }))) return 'staff' as const;
    const port = createKeyManagementPort();
    const sessionRef = await neonSessionRef();
    if (!port || !sessionRef) return 'failed' as const;
    const checked = await verifyStaffFactor(db, port, { accountId, code, sessionRef });
    if (checked.ok) return 'ok' as const;
    return checked.error.code === 'rate_limited' ? ('slow' as const) : ('wrong' as const);
  });
  if (outcome === 'staff') redirect(NOT_STAFF);
  if (outcome === 'ok') redirect(returnTo);
  redirect(`${back}&e=${outcome}`);
}

/** New backup codes, replacing the old ones. Needs a code proved in the last five minutes. */
export async function regenerateRecoveryCodesAction(
  _prev: StaffCodeState,
  _formData: FormData,
): Promise<StaffCodeState> {
  return withSession(async ({ db, accountId, email }): Promise<StaffCodeState> => {
    if (!(await holdsPlatformRole(db, { accountId, email }))) {
      return { ok: false, message: 'This is only for platform staff.' };
    }
    const sessionRef = await neonSessionRef();
    if (!sessionRef) return { ok: false, message: 'Sign in again and try once more.' };
    // A backup code alone must not be enough to replace the whole set: a recent password too.
    if (!(await passwordIsRecent())) {
      return { ok: false, message: 'Sign in again with your password, then try once more.' };
    }
    const done = await regenerateStaffRecoveryCodes(db, { accountId, sessionRef });
    if (!done.ok) {
      return {
        ok: false,
        message:
          done.error.code === 'step_up_required'
            ? 'Enter a code from your app first, then try again.'
            : done.error.message,
      };
    }
    return {
      ok: true,
      message: 'New backup codes. The old ones no longer work. Save these now.',
      recoveryCodes: done.value.recoveryCodes,
    };
  });
}
