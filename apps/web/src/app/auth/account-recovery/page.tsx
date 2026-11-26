import Link from 'next/link';
import { publicMessage, publicText } from '../../../components/public-site/public-text';
import { MISC_MESSAGES as X } from '../../../i18n/misc-messages';
import { getPageLanguage, primeLocale } from '../../../lib/i18n-server';
import { localizedMetadata } from '../../../lib/localized-metadata';
import { signOutCurrentUser } from '../../../lib/sign-out';
import { AuthShell } from '../auth-ui';

export const generateMetadata = localizedMetadata({ title: 'Account Access Needs Verification' });

export default async function AccountRecoveryPage() {
  const locale = await primeLocale();
  const lang = getPageLanguage();
  const pm = (message: Parameters<typeof publicMessage>[0]) => publicMessage(message, lang, locale);
  return (
    <AuthShell title={publicText('Account Access Needs Verification', lang, locale)}>
      <p className="card-body">{pm(X['misc.recovery.one'])}</p>
      <p className="card-body">{pm(X['misc.recovery.two'])}</p>
      <div className="cta-row">
        <form
          action={async () => {
            'use server';
            await signOutCurrentUser();
          }}
        >
          <button type="submit" className="btn btn-primary">
            {pm(X['misc.signOut'])}
          </button>
        </form>
        <Link className="btn btn-secondary" href="/">
          {pm(X['misc.backHome'])}
        </Link>
      </div>
    </AuthShell>
  );
}
