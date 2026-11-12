import type { Metadata } from 'next';
import Link from 'next/link';
import { authCatalog } from '../../../i18n/auth';
import { getServerT, primeLocale } from '../../../lib/i18n-server';
import { requestPasswordResetAction } from '../actions';
import { AuthShell, ErrorLine, Notice, TextField } from '../auth-ui';

export const metadata: Metadata = { title: 'Reset Your Password' };
export const dynamic = 'force-dynamic';

const ERRORS: Record<string, string> = {
  invalid: 'Enter a valid email address.',
  slow: 'Too many requests. Please wait a little while and try again.',
  unavailable: 'We could not request a link right now. Please try again in a few minutes.',
  expired: 'That link has expired or was already used. Ask for a new one below.',
};

export default async function ForgotPasswordPage({
  searchParams,
}: { searchParams: Promise<{ e?: string; sent?: string }> }) {
  await primeLocale();
  const t = getServerT(authCatalog);
  const { e, sent } = await searchParams;
  const error = e ? ERRORS[e] : undefined;
  return (
    <AuthShell title={t.node('auth.authForgotPasswordPage.resetYourPassword')}>
      {sent === '1' ? (
        <div className="card u-mb-100">
          <h2 className="card-title">{t.node('auth.authForgotPasswordPage.checkYourEmail')}</h2>
          <Notice>{t.node('auth.authForgotPasswordPage.ifAnAccountUsesThatAddress')}</Notice>
          <details className="u-mt-100">
            <summary>{t.node('auth.authForgotPasswordPage.didNotGetALinkSend')}</summary>
            <p className="card-body">
              {t.node('auth.authForgotPasswordPage.waitAFewMinutesThenEnter')}
            </p>
            <RecoveryForm resend />
          </details>
          <p className="card-body u-mt-100">
            <Link href="/auth/forgot-password">
              {t.node('auth.authForgotPasswordPage.useADifferentEmailAddress')}
            </Link>
            {' · '}
            <Link href="/auth/sign-up">
              {t.node('auth.authForgotPasswordPage.createAnAccount')}
            </Link>
          </p>
        </div>
      ) : (
        <>
          <ErrorLine id="forgot-error" message={error} />
          <div className="card u-mb-100">
            <RecoveryForm error={error} />
          </div>
        </>
      )}
      <p className="card-body">
        <Link href="/auth/sign-in">{t.node('auth.authForgotPasswordPage.backToSignIn')}</Link>
      </p>
    </AuthShell>
  );
}

function RecoveryForm({ error, resend = false }: { error?: string | undefined; resend?: boolean }) {
  const t = getServerT(authCatalog);
  return (
    <form action={requestPasswordResetAction} className="field-list">
      <TextField
        id={resend ? 'resend-email' : 'email'}
        name="email"
        type="email"
        label={t('auth.authForgotPasswordPage.emailAddress')}
        autoComplete="email"
        required
        maxLength={254}
        errorId={error ? 'forgot-error' : undefined}
      />
      <button type="submit" className="btn btn-primary">
        {resend
          ? t.node('auth.authForgotPasswordPage.sendAnotherLink')
          : t.node('auth.authForgotPasswordPage.sendMeALink')}
      </button>
    </form>
  );
}
