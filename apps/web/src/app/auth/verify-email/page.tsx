import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { authCatalog } from '../../../i18n/auth';
import { getServerT, primeLocale } from '../../../lib/i18n-server';
import { safeReturnPath } from '../../../lib/neon-recency';
import {
  PENDING_CONFIRMATION_COOKIE,
  decodePendingConfirmation,
  maskEmail,
} from '../../../lib/pending-confirmation';
import { resendConfirmationAction } from '../actions';
import { AuthShell, ErrorLine, Notice, TextField } from '../auth-ui';

export const metadata: Metadata = { title: 'Confirm Your Email Address' };
export const dynamic = 'force-dynamic';

const ERRORS: Record<string, string> = {
  expired: 'That link has expired or was already used. We can send you a new one.',
  invalid: 'Enter a valid email address.',
  slow: 'Too many requests. Please wait a little while and try again.',
  unavailable: 'We could not request your confirmation email right now. Please try again shortly.',
};

export default async function VerifyEmailPage({
  searchParams,
}: { searchParams: Promise<{ e?: string; s?: string; next?: string }> }) {
  await primeLocale();
  const t = getServerT(authCatalog);
  const { e, s, next } = await searchParams;
  const error = e ? ERRORS[e] : undefined;
  // The address this browser just asked us to confirm (signed, short-lived): with it, the page
  // says where the link went and sends it again in one tap, without asking for the address again.
  const remembered = decodePendingConfirmation(
    (await cookies()).get(PENDING_CONFIRMATION_COOKIE)?.value,
  );
  const returnPath = safeReturnPath(next);
  const addressForm = (
    <form action={resendConfirmationAction} className="field-list">
      <input type="hidden" name="next" value={returnPath} />
      <TextField
        id="email"
        name="email"
        type="email"
        label={t('auth.authForgotPasswordPage.emailAddress')}
        autoComplete="email"
        required
        maxLength={254}
        errorId={error ? 'verify-error' : undefined}
      />
      <button type="submit" className="btn btn-primary">
        {t('auth.authVerifyEmailPage.sendTheLinkAgain')}
      </button>
    </form>
  );
  return (
    <AuthShell title={t('auth.authVerifyEmailPage.confirmYourEmailAddress')}>
      <ol className="auth-steps" aria-label={t('auth.authSignUpPage.theThreeSteps')}>
        <li>{t('auth.authSignUpPage.1CreateYourAccount')}</li>
        <li aria-current="step">{t('auth.authSignUpPage.2ConfirmYourEmail')}</li>
        <li>{t('auth.authSignUpPage.3SignIn')}</li>
      </ol>
      {remembered ? (
        <>
          <p className="card-body">
            {s === '1'
              ? 'We sent a confirmation link to '
              : 'Confirm your address to continue. We can send a link to '}
            <strong>{maskEmail(remembered)}</strong>.
            {s === '1'
              ? ' It can take a few minutes, and it may land in your spam folder. The email comes from VisaStack. Once you have opened the link, sign in.'
              : ''}
          </p>
          <ErrorLine id="verify-error" message={error} />
          <div className="card u-mb-100">
            <form action={resendConfirmationAction} className="field-list">
              <input type="hidden" name="next" value={returnPath} />
              <input type="hidden" name="saved" value="1" />
              <button type="submit" className="btn btn-primary">
                {s === '1'
                  ? t('auth.authVerifyEmailPage.sendTheLinkAgain')
                  : t('auth.authVerifyEmailPage.sendTheLink')}
              </button>
            </form>
            <details className="verify-other-address">
              <summary>{t('auth.authVerifyEmailPage.useADifferentEmail')}</summary>
              {addressForm}
            </details>
          </div>
        </>
      ) : (
        <>
          <p className="card-body">
            {s === '1'
              ? t('auth.authVerifyEmailPage.checkYourInboxIfYourAddress')
              : t('auth.authVerifyEmailPage.youNeedToConfirmYourEmail')}
          </p>
          {s === '1' ? <Notice>{t('auth.authVerifyEmailPage.ifYouDoNotSeeIt')}</Notice> : null}
          <ErrorLine id="verify-error" message={error} />
          <div className="card u-mb-100">{addressForm}</div>
        </>
      )}
      <p className="card-body">
        <Link href={`/auth/sign-in?next=${encodeURIComponent(returnPath)}`}>
          {t('auth.authForgotPasswordPage.backToSignIn')}
        </Link>
      </p>
    </AuthShell>
  );
}
