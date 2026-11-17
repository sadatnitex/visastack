import type { Metadata } from 'next';
import { authCatalog } from '../../../i18n/auth';
import { getServerT, primeLocale } from '../../../lib/i18n-server';
import { safeReturnPath } from '../../../lib/neon-recency';
import { passkeyOfferedAtReauth } from '../../../lib/passkey-offer';
import {
  googleSignInEnabled,
  sessionSignInMethods,
  withTimeout,
} from '../../../lib/social-sign-in';
import { reauthAction } from '../actions';
import { AuthShell, ErrorLine, TextField } from '../auth-ui';
import { GoogleButton } from '../google-button';
import { PasskeyConfirm } from '../passkey-confirm';

export const metadata: Metadata = { title: 'Confirm it is you' };
export const dynamic = 'force-dynamic';

const ERRORS: Record<string, string> = {
  invalid: 'Enter your password (8 to 128 characters).',
  failed: 'That password was not right. Try again.',
  slow: 'Too many attempts. Please wait a little while and try again.',
};

/** A stalled Neon Auth must not hang this page: after this long the password page is shown. */
const ACCOUNT_LOOKUP_TIMEOUT_MS = 3000;

/**
 * True for a signed-in person whose only way in is Google (no password), who could never pass the
 * password check below. Only asked when Google sign-in is on, and anything unreadable keeps the
 * password page. Signing in with Google again makes a new session, which is what this page is for.
 */
async function signsInWithGoogleOnly(): Promise<boolean> {
  if (!googleSignInEnabled()) return false;
  try {
    return (await withTimeout(sessionSignInMethods(), ACCOUNT_LOOKUP_TIMEOUT_MS)) === 'google-only';
  } catch {
    return false;
  }
}

export default async function ReauthPage({
  searchParams,
}: { searchParams: Promise<{ e?: string; returnTo?: string }> }) {
  await primeLocale();
  const t = getServerT(authCatalog);
  const { e, returnTo } = await searchParams;
  const error = e ? ERRORS[e] : undefined;
  if (await signsInWithGoogleOnly()) {
    return (
      <AuthShell title={t.node('auth.authReauthPage.confirmItIsYou')}>
        <p className="card-body" lang="en">
          You signed in with Google, so there is no password to type. Sign in with Google again to
          continue.
        </p>
        <GoogleButton next={safeReturnPath(returnTo)} notice={false} />
      </AuthShell>
    );
  }
  return (
    <AuthShell title={t.node('auth.authReauthPage.confirmItIsYou')}>
      <p className="card-body">{t.node('auth.authReauthPage.forYourSafetyPleaseTypeYour')}</p>
      {(await passkeyOfferedAtReauth()) ? (
        <PasskeyConfirm returnTo={safeReturnPath(returnTo)} />
      ) : null}
      <ErrorLine id="reauth-error" message={error} />
      <div className="card u-mb-100">
        <form action={reauthAction} className="field-list">
          <input type="hidden" name="returnTo" value={safeReturnPath(returnTo)} />
          <TextField
            id="password"
            name="password"
            type="password"
            label={t('auth.authReauthPage.password')}
            autoComplete="current-password"
            required
            minLength={8}
            maxLength={128}
            errorId={error ? 'reauth-error' : undefined}
          />
          <button type="submit" className="btn btn-primary">
            {t.node('auth.authReauthPage.continue')}
          </button>
        </form>
      </div>
    </AuthShell>
  );
}
