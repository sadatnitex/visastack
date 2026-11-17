import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { authCatalog } from '../../../i18n/auth';
import { getServerT, primeLocale } from '../../../lib/i18n-server';
import { safeReturnPath } from '../../../lib/neon-recency';
import {
  PENDING_CONFIRMATION_COOKIE,
  decodePendingConfirmation,
} from '../../../lib/pending-confirmation';
import { signInLinksEnabled } from '../../../lib/sign-in-links';
import { signInAction, signInLinkAction } from '../actions';
import { AuthShell, ErrorLine, Notice, TextField } from '../auth-ui';
import { GoogleButton } from '../google-button';

export const metadata: Metadata = { title: 'Sign In' };
export const dynamic = 'force-dynamic';

const ERRORS: Record<string, string> = {
  invalid: 'Enter a valid email address and a password of at least 8 characters.',
  failed: 'We could not sign you in with those details. Check them and try again.',
  slow: 'Too many attempts. Please wait a little while and try again.',
  social: 'We could not sign you in with Google. Try again, or use your email and password.',
  social_off: 'Google sign-in is not available yet. Use your email and password.',
  social_start:
    'Google sign-in could not start from here. Use the Continue with Google button on this page, or sign in with your email and password.',
  link_invalid: 'Enter a valid email address to get a sign-in link.',
  link: 'Open the link on the device where you asked for it, or ask for a new one below.',
  link_expired: 'That sign-in link has expired or was already used. Ask for a new one below.',
  link_slow: 'Too many sign-in links were asked for. Please wait a little while and try again.',
  link_staff: 'Staff accounts sign in with the email address and password.',
};

/** The codes about the email form itself; the others describe Google and must not mark the form invalid. */
const FORM_ERRORS = new Set(['invalid', 'failed', 'slow']);

const NOTICES: Record<string, string> = {
  created: 'Your account is ready. Check your inbox to confirm your email address, then sign in.',
  confirmed: 'Your email address is confirmed. You can sign in now.',
  reset: 'Your password has been changed. Sign in with the new one.',
  link_sent:
    'We sent a sign-in link to that address. Open it soon, on this device. If it does not arrive, check your spam folder.',
};

export default async function SignInPage({
  searchParams,
}: { searchParams: Promise<{ e?: string; n?: string; next?: string }> }) {
  await primeLocale();
  const t = getServerT(authCatalog);
  const { e, n, next } = await searchParams;
  const error = e ? ERRORS[e] : undefined;
  const formError = e && FORM_ERRORS.has(e) ? error : undefined;
  const notice = n ? NOTICES[n] : undefined;
  // After the confirmation link, start with the address this browser just asked us to confirm
  // (the signed, short-lived cookie the confirmation page already uses). It is read here and put
  // in the form only: the address is never added to a link, so it cannot reach logs or history.
  const prefill =
    n === 'confirmed'
      ? decodePendingConfirmation((await cookies()).get(PENDING_CONFIRMATION_COOKIE)?.value)
      : null;
  return (
    <AuthShell title={t.node('auth.authSignInPage.signIn')}>
      {notice ? <Notice>{notice}</Notice> : null}
      <ErrorLine id="signin-error" message={error} />
      <GoogleButton next={next} notice />
      <div className="card u-mb-100">
        <form action={signInAction} className="field-list">
          <input type="hidden" name="next" value={safeReturnPath(next)} />
          <TextField
            id="email"
            name="email"
            type="email"
            label={t('auth.authForgotPasswordPage.emailAddress')}
            autoComplete="email"
            required
            maxLength={254}
            defaultValue={prefill ?? undefined}
            errorId={formError ? 'signin-error' : undefined}
          />
          <TextField
            id="password"
            name="password"
            type="password"
            label={t('auth.authReauthPage.password')}
            autoComplete="current-password"
            required
            minLength={8}
            maxLength={128}
          />
          <button type="submit" className="btn btn-primary">
            {t.node('auth.authSignInPage.signIn')}
          </button>
        </form>
      </div>
      {signInLinksEnabled() ? (
        <div className="card u-mb-100">
          <form action={signInLinkAction} className="field-list">
            <input type="hidden" name="next" value={safeReturnPath(next)} />
            <TextField
              id="link-email"
              name="email"
              type="email"
              label="Or Get a Sign-In Link by Email"
              errorId={e === 'link_invalid' || e === 'link_slow' ? 'signin-error' : undefined}
              autoComplete="email"
              required
              maxLength={254}
            />
            <button type="submit" className="btn btn-secondary">
              Email Me a Sign-In Link
            </button>
          </form>
        </div>
      ) : null}
      <p className="card-body">
        <Link href="/auth/forgot-password">{t.node('auth.authSignInPage.forgotYourPassword')}</Link>
      </p>
      <p className="card-body">
        New here?{' '}
        <Link href={`/auth/sign-up?next=${encodeURIComponent(safeReturnPath(next))}`}>
          Create an Account
        </Link>
      </p>
    </AuthShell>
  );
}
