import type { Metadata } from 'next';
import Link from 'next/link';
import { authCatalog } from '../../../i18n/auth';
import { getServerT, primeLocale } from '../../../lib/i18n-server';
import { resetPasswordAction } from '../actions';
import { AuthShell, ErrorLine, TextField } from '../auth-ui';

export const metadata: Metadata = { title: 'Choose a New Password' };
// The email link carries a one-time code, so the form page tells the browser not to pass it on.
export const dynamic = 'force-dynamic';

const ERRORS: Record<string, string> = {
  invalid: 'Choose a password of 8 to 128 characters.',
  mismatch: 'The two passwords do not match.',
};

export default async function ResetPasswordPage({
  searchParams,
}: { searchParams: Promise<{ token?: string; e?: string; error?: string }> }) {
  await primeLocale();
  const t = getServerT(authCatalog);
  const { token, e, error: linkError } = await searchParams;
  if (!token || linkError) {
    return (
      <AuthShell title={t.node('auth.authResetPasswordPage.chooseANewPassword')}>
        <ErrorLine
          id="reset-error"
          message={t('auth.authResetPasswordPage.thatLinkHasExpiredOrIs')}
        />
        <p className="card-body">
          <Link href="/auth/forgot-password">
            {t.node('auth.authResetPasswordPage.sendMeANewLink')}
          </Link>
        </p>
      </AuthShell>
    );
  }
  const error = e ? ERRORS[e] : undefined;
  return (
    <AuthShell title={t.node('auth.authResetPasswordPage.chooseANewPassword')}>
      <meta name="referrer" content="no-referrer" />
      <ErrorLine id="reset-error" message={error} />
      <div className="card u-mb-100">
        <form action={resetPasswordAction} className="field-list">
          <input type="hidden" name="token" value={token} />
          <TextField
            id="password"
            name="password"
            type="password"
            label={t('auth.authResetPasswordPage.newPasswordAtLeast8Characters')}
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={128}
            errorId={error ? 'reset-error' : undefined}
          />
          <TextField
            id="confirm"
            name="confirm"
            type="password"
            label={t('auth.authResetPasswordPage.typeTheNewPasswordAgain')}
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={128}
          />
          <button type="submit" className="btn btn-primary">
            {t.node('auth.authResetPasswordPage.changePassword')}
          </button>
        </form>
      </div>
    </AuthShell>
  );
}
