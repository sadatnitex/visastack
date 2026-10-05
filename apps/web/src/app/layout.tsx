import { withAuth } from '@workos-inc/authkit-nextjs';
import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { LocaleProvider } from '../components/locale-provider';
import { PilotBanner } from '../components/pilot-banner';
import { getDeploymentMode } from '../lib/deployment-mode';
import { getI18n } from '../lib/locale';
import { setLocaleAction } from './actions';
import './globals.css';

/**
 * The page title is in the visitor's language (it is what the browser tab shows and what a
 * screen reader announces first). The description is search-engine marketing copy that is
 * still awaiting the owner's content review (known-issues, chunk 37), so it stays English.
 */
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
    title: t('shell.meta.title'),
    description:
      'A universal, pack-composable visa and immigration platform. Turn documents into structured, permission-aware profiles through a governed, AI-assisted (or fully manual) workflow.',
  };
}

// Match the browser chrome to the theme in both light and dark (Apple-style).
export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fbfbfd' },
    { media: '(prefers-color-scheme: dark)', color: '#000000' },
  ],
};

export default async function RootLayout({ children }: { readonly children: ReactNode }) {
  // Read-only auth check so the nav reflects the real session (middleware owns
  // the refresh, so this never writes cookies during render). Defaults to
  // signed-out if the read fails, so a hiccup never breaks the whole shell.
  let signedIn = false;
  try {
    const { user } = await withAuth();
    signedIn = Boolean(user);
  } catch {
    signedIn = false;
  }
  const { locale, t } = await getI18n();
  const deploymentMode = getDeploymentMode();
  const otherLocale = locale === 'en' ? 'bn' : 'en';

  return (
    <html lang={locale}>
      <body>
        <a className="skip-link" href="#main">
          {t('shell.skipToContent')}
        </a>
        <PilotBanner mode={deploymentMode} t={t} />
        <header className="nav">
          <Link className="brand" href="/">
            VisaStack
          </Link>
          <nav className="nav-links" aria-label={t('shell.nav.primary')}>
            <Link href="/#capabilities">{t('shell.nav.platform')}</Link>
            <Link href="/trust">{t('shell.nav.publicTrust')}</Link>
            <Link href="/status">{t('shell.nav.status')}</Link>
            <form action={setLocaleAction} aria-label={t('shell.language')}>
              <input type="hidden" name="locale" value={otherLocale} />
              {/* Named in its own language and marked as such, so a screen reader pronounces it correctly and a Bangla reader can find it. */}
              <button type="submit" className="lang-switch" lang={otherLocale}>
                {otherLocale === 'bn' ? 'বাংলা' : 'English'}
              </button>
            </form>
            <a className="btn btn-secondary nav-cta" href="/app">
              {signedIn ? t('nav.workspace') : t('nav.signIn')}
            </a>
          </nav>
        </header>
        <main id="main">
          <LocaleProvider locale={locale}>{children}</LocaleProvider>
        </main>
        <footer className="footer">
          <div className="container footer-inner">
            <span>{t('shell.footer.rights', { year: new Date().getFullYear() })}</span>
            <span>{t('shell.footer.hosting')}</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
