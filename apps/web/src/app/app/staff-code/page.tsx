import {
  STAFF_FACTOR_FRESH_MS,
  type StaffFactorEnrolment,
  type StaffFactorStatus,
  getStaffFactorStatus,
  isStaffFactorFresh,
  revealPendingStaffEnrolment,
} from '@visastack/services';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { PageHeader } from '../../../components/ui';
import { bootstrapAdminEmails, isPlatformAdmin } from '../../../lib/admin';
import { neonSessionRef, safeReturnPath } from '../../../lib/neon-recency';
import { createKeyManagementPort } from '../../../lib/providers';
import { withSession } from '../../../lib/session';
import { staffFactorMode } from '../../../lib/staff-factor';
import { startStaffEnrolmentAction, verifyStaffCodeAction } from './actions';
import { ConfirmEnrolmentForm, RegenerateCodesForm } from './forms';
import { QrCode } from './qr-code';

export const metadata: Metadata = { title: 'Authenticator Code' };
export const dynamic = 'force-dynamic';

const ERRORS: Record<string, string> = {
  empty: 'Enter the code from your authenticator app.',
  wrong: 'That code did not work. Check it and try again.',
  slow: 'Too many tries. Wait a few minutes, or ask a platform owner to reset your authenticator.',
  failed: 'Authenticator codes cannot be checked right now. Try again in a moment.',
  nokey: 'An authenticator app cannot be set up here yet.',
  active: 'An authenticator app is already set up for this account.',
};

type View =
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'start' }
  | { readonly kind: 'confirm'; readonly enrolment: StaffFactorEnrolment }
  | { readonly kind: 'verify' }
  | { readonly kind: 'manage' }
  | { readonly kind: 'verified' };

/** Where staff set up the authenticator app and enter a code. It sits outside the platform area on purpose, so it can never send a person round in a circle. */
export default async function StaffCodePage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string; e?: string; manage?: string }>;
}) {
  const { returnTo: rawReturnTo, e, manage } = await searchParams;
  const requested = safeReturnPath(rawReturnTo);
  const returnTo = requested.startsWith('/app/staff-code') ? '/app/admin' : requested;

  const view = await withSession(async ({ db, accountId, email }): Promise<View | 'not_staff'> => {
    if (!(await isPlatformAdmin(db, { accountId, email }))) return 'not_staff';
    const status: StaffFactorStatus = await getStaffFactorStatus(db, accountId);
    if (status.state === 'unavailable') return { kind: 'unavailable' };
    if (status.state === 'none') return { kind: 'start' };
    if (status.state === 'pending') {
      const port = createKeyManagementPort();
      if (!port) return { kind: 'unavailable' };
      const shown = await revealPendingStaffEnrolment(db, port, {
        accountId,
        email,
        bootstrapEmails: bootstrapAdminEmails(),
      });
      return shown.ok ? { kind: 'confirm', enrolment: shown.value } : { kind: 'start' };
    }
    const sessionRef = await neonSessionRef();
    const fresh =
      sessionRef !== null &&
      (await isStaffFactorFresh(db, { accountId, sessionRef, maxAgeMs: STAFF_FACTOR_FRESH_MS }));
    if (fresh) return manage ? { kind: 'manage' } : { kind: 'verified' };
    return { kind: 'verify' };
  });
  if (view === 'not_staff') redirect('/app');

  const error = e ? ERRORS[e] : undefined;
  return (
    <section className="section container">
      <PageHeader
        eyebrow="Platform"
        title="Authenticator Code"
        description="Platform staff confirm each sensitive action with a code from an authenticator app."
      />
      {staffFactorMode() === 'off' ? (
        <output className="notice notice-warn u-mb-150">
          Codes are not required yet. You can set up your app now so you are ready.
        </output>
      ) : null}
      {error ? (
        <p className="field-msg field-msg-err u-mb-100" role="alert">
          {error}
        </p>
      ) : null}

      {view.kind === 'unavailable' ? (
        <output className="notice notice-warn">
          Authenticator codes cannot be checked right now. Try again in a moment.
        </output>
      ) : null}

      {view.kind === 'start' ? (
        <article className="card">
          <h2 className="card-title">Set Up Your Authenticator App</h2>
          <p className="card-body u-mb-100">
            Use any authenticator app on your phone. You will scan a picture, then type one code to
            turn it on. We ask for your password first.
          </p>
          <form action={startStaffEnrolmentAction}>
            <input type="hidden" name="returnTo" value={returnTo} />
            <button type="submit" className="btn btn-primary">
              Start Setup
            </button>
          </form>
        </article>
      ) : null}

      {view.kind === 'confirm' ? (
        <article className="card">
          <h2 className="card-title">Scan This With Your App</h2>
          <p className="card-body u-mb-100">
            Open your authenticator app, choose to add an account, and scan the picture. If you
            cannot scan it, type the key below instead.
          </p>
          <QrCode
            text={view.enrolment.otpauthUri}
            label="Picture to scan with your authenticator app"
          />
          <p className="card-body u-mt-100">
            Key to type instead: <code>{view.enrolment.manualKey}</code>
          </p>
          <ConfirmEnrolmentForm returnTo={returnTo} />
        </article>
      ) : null}

      {view.kind === 'verify' ? (
        <article className="card">
          <h2 className="card-title">Enter Your Authenticator Code</h2>
          <form action={verifyStaffCodeAction} className="field-list">
            <input type="hidden" name="returnTo" value={returnTo} />
            <div className="field-row">
              <label className="field-label" htmlFor="staff-code">
                6 Digit Code Or A Backup Code
              </label>
              <input
                id="staff-code"
                name="code"
                className="input"
                inputMode="text"
                autoComplete="one-time-code"
                maxLength={32}
                required
                aria-describedby={error ? 'staff-code-error' : undefined}
                aria-invalid={error ? true : undefined}
              />
            </div>
            <button type="submit" className="btn btn-primary">
              Continue
            </button>
          </form>
          <p className="card-body u-mt-100">
            Lost your phone? Type one of your backup codes in the same box. If you have none, ask a
            platform owner to reset your authenticator.
          </p>
        </article>
      ) : null}

      {view.kind === 'verified' ? (
        <article className="card">
          <h2 className="card-title">You Are Confirmed</h2>
          <p className="card-body u-mb-100">Your code was accepted for the next few minutes.</p>
          <a className="btn btn-primary" href={returnTo}>
            Continue
          </a>{' '}
          <a
            className="btn btn-secondary"
            href={`/app/staff-code?manage=1&returnTo=${encodeURIComponent(returnTo)}`}
          >
            Manage Backup Codes
          </a>
        </article>
      ) : null}

      {view.kind === 'manage' ? (
        <article className="card">
          <h2 className="card-title">Backup Codes</h2>
          <RegenerateCodesForm returnTo={returnTo} />
        </article>
      ) : null}
    </section>
  );
}
