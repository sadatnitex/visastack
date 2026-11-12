import type { Metadata } from 'next';
import { authCatalog } from '../../../i18n/auth';
import { getServerT, primeLocale } from '../../../lib/i18n-server';
import { safeReturnPath } from '../../../lib/neon-recency';
import { reauthAction } from '../actions';
import { AuthShell, ErrorLine, TextField } from '../auth-ui';

export const metadata: Metadata = { title: 'Confirm it is you' };
export const dynamic = 'force-dynamic';

const ERRORS: Record<string, string> = {
  invalid: 'Enter your password (8 to 128 characters).',
  failed: 'That password was not right. Try again.',
  slow: 'Too many attempts. Please wait a little while and try again.',
};

export default async function ReauthPage({
  searchParams,
}: { searchParams: Promise<{ e?: string; returnTo?: string }> }) {
  await primeLocale();
  const t = getServerT(authCatalog);
  const { e, returnTo } = await searchParams;
  const error = e ? ERRORS[e] : undefined;
  return (
    <AuthShell title={t('auth.authReauthPage.confirmItIsYou')}>
      <p className="card-body">{t('auth.authReauthPage.forYourSafetyPleaseTypeYour')}</p>
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
            {t('auth.authReauthPage.continue')}
          </button>
        </form>
      </div>
    </AuthShell>
  );
}
