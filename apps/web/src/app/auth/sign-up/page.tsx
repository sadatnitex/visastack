import Link from 'next/link';
import { publicMessage, publicText } from '../../../components/public-site/public-text';
import { authCatalog } from '../../../i18n/auth';
import { MISC_MESSAGES as X } from '../../../i18n/misc-messages';
import { getPageLanguage, getServerT, primeLocale } from '../../../lib/i18n-server';
import { localizedMetadata } from '../../../lib/localized-metadata';
import { safeReturnPath } from '../../../lib/neon-recency';
import { isPublicBetaOpen } from '../../../lib/public-beta';
import { createSignupForm } from '../../../lib/signup-form';
import { signUpAction } from '../actions';
import { AuthShell, ErrorLine, TextField } from '../auth-ui';
import { GoogleButton } from '../google-button';

export const generateMetadata = localizedMetadata({ title: 'Create an Account' });
export const dynamic = 'force-dynamic';

const ERRORS: Record<string, string> = {
  invalid: 'Enter a valid email address and a password of at least 8 characters.',
  failed: 'We could not create that account. Try a different email address or sign in instead.',
  exists: 'An account already uses this email. Sign in or reset your password.',
  unavailable: 'We could not check your account right now. Please try again shortly.',
  slow: 'Too many attempts. Please wait a little while and try again.',
  notices: 'Read and acknowledge the terms and privacy notice before creating your account.',
  refresh: 'Reload this page and try again. Your registration form could not be accepted.',
};

export default async function SignUpPage({
  searchParams,
}: { searchParams: Promise<{ e?: string; next?: string }> }) {
  const locale = await primeLocale();
  const lang = getPageLanguage();
  const pm = (message: Parameters<typeof publicMessage>[0]) => publicMessage(message, lang, locale);
  const t = getServerT(authCatalog);
  const { e, next } = await searchParams;
  const error = e ? ERRORS[e] : undefined;
  const signupForm = createSignupForm();
  return (
    <AuthShell
      title={t.node('auth.authSignUpPage.createYourAccount')}
      variant="signup"
      eyebrow={
        isPublicBetaOpen()
          ? t('auth.authSignUpPage.publicBetaFreeAccount')
          : t('auth.authSignUpPage.privatePilot')
      }
      utility={
        <>
          {pm(X['misc.haveAccount'])}{' '}
          <Link href={`/auth/sign-in?next=${encodeURIComponent(safeReturnPath(next))}`}>
            {publicText('Sign In', lang, locale)}
          </Link>
        </>
      }
    >
      {/* Phone-first (owner list item 17): only what creating the account needs. The traveller or
          agency choice that used to sit here was guidance only (the server never read it), so it is
          gone; one account serves both, and agencies start from the account menu after sign-in. */}
      <p className="card-body signup-introduction">
        {t.node('auth.authSignUpPage.oneProfileYouCanUseAgain')}
      </p>
      {!isPublicBetaOpen() ? (
        <p className="card-body signup-invite-note">
          {t.node('auth.authSignUpPage.accessIsByInvitation')}
        </p>
      ) : null}
      <ol className="auth-steps" aria-label={t('auth.authSignUpPage.theThreeSteps')}>
        <li aria-current="step">{t.node('auth.authSignUpPage.1CreateYourAccount')}</li>
        <li>{t.node('auth.authSignUpPage.2ConfirmYourEmail')}</li>
        <li>{t.node('auth.authSignUpPage.3SignIn')}</li>
      </ol>
      <ErrorLine id="signup-error" message={error} />
      {e === 'exists' && (
        <p className="card-body">
          <Link href={`/auth/sign-in?next=${encodeURIComponent(safeReturnPath(next))}`}>
            Sign In
          </Link>{' '}
          or <Link href="/auth/forgot-password">reset your password</Link>.
        </p>
      )}
      <GoogleButton next={next} notice />
      <div className="card u-mb-100">
        <form action={signUpAction} className="field-list">
          <input type="hidden" name="next" value={safeReturnPath(next)} />
          <input type="hidden" name="signupForm" value={signupForm} />
          <div hidden aria-hidden="true">
            <label htmlFor="signup-website">
              {t.node('auth.authSignUpPage.leaveThisFieldEmpty')}
            </label>
            <input id="signup-website" name="website" autoComplete="off" tabIndex={-1} />
          </div>
          <TextField
            id="name"
            name="name"
            label={t('auth.authSignUpPage.yourNameOptional')}
            autoComplete="name"
            maxLength={120}
          />
          <TextField
            id="email"
            name="email"
            type="email"
            label={t('auth.authForgotPasswordPage.emailAddress')}
            autoComplete="email"
            required
            maxLength={254}
            errorId={error ? 'signup-error' : undefined}
          />
          <TextField
            id="password"
            name="password"
            type="password"
            label={t('auth.authSignUpPage.passwordAtLeast8Characters')}
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={128}
          />
          <label className="card-body signup-consent" htmlFor="accept-notices">
            <input id="accept-notices" type="checkbox" name="acceptNotices" value="yes" required />{' '}
            {pm(X['misc.consent.agree'])} <Link href="/terms">{pm(X['misc.consent.terms'])}</Link>{' '}
            {pm(X['misc.consent.acknowledge'])}{' '}
            <Link href="/privacy">{pm(X['misc.consent.privacy'])}</Link>.
          </label>
          <p className="card-body signup-notice-note">
            {t.node('auth.authSignUpPage.thisAcknowledgementDoesNotEnableMarketing')}
          </p>
          <button type="submit" className="btn btn-primary">
            {t.node('auth.authSignUpPage.createFreeAccount')}
          </button>
        </form>
      </div>
      <p className="card-body signup-confirmation-note">
        {t.node('auth.authSignUpPage.weWillEmailYouALink')}
      </p>
    </AuthShell>
  );
}
