import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { PilotBanner } from '../components/pilot-banner';
import { getDeploymentMode } from '../lib/deployment-mode';
import { getLocale } from '../lib/locale';
import { createIdentityPort } from '../lib/providers';
import { reportServerError } from '../lib/server-error';
import { setLocaleAction } from './actions';
import './globals.css';

/**
 * Self-hosted fonts (see `fonts/README.md`): Inter for Latin text and Noto Sans Bengali for
 * Bangla, so numbers, dates and Bengali letters read well on every device. The Bengali file
 * is only fetched when a page shows Bangla text. Both are served from this site, so the page
 * security policy (`font-src 'self'`) is unchanged.
 */
const inter = localFont({
  src: './fonts/inter-latin-wght-normal.woff2',
  variable: '--font-inter',
  display: 'swap',
  weight: '100 900',
});
const bengali = localFont({
  src: './fonts/noto-sans-bengali-bengali-wght-normal.woff2',
  variable: '--font-bengali',
  display: 'swap',
  weight: '100 900',
  preload: false,
});

export const metadata: Metadata = {
  // Every page names itself (WCAG 2.4.2): the page's own title, then the product.
  title: { default: 'VisaStack - one profile, every visa', template: '%s | VisaStack' },
  description:
    'Keep your passport, documents and visa details in one private profile and reuse them for every application. Invite-only pilot.',
};

// Match the browser chrome to the theme in both light and dark.
export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f7f9' },
    { media: '(prefers-color-scheme: dark)', color: '#0a1220' },
  ],
};

export default async function RootLayout({ children }: { readonly children: ReactNode }) {
  // Read-only auth check so the nav reflects the real session (middleware owns
  // the refresh, so this never writes cookies during render). Defaults to
  // signed-out if the read fails, so a hiccup never breaks the whole shell.
  let signedIn = false;
  try {
    signedIn = Boolean(await createIdentityPort().currentIdentity());
  } catch (error) {
    reportServerError('root navigation identity', error);
    signedIn = false;
  }
  const locale = await getLocale();
  const deploymentMode = getDeploymentMode();

  return (
    <html lang={locale} className={`${inter.variable} ${bengali.variable}`}>
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <PilotBanner mode={deploymentMode} />
        <header className="nav">
          <Link className="brand" href="/">
            <span className="brand-mark" aria-hidden="true" />
            VisaStack
          </Link>
          <nav className="nav-links" aria-label="Site">
            <Link href="/#capabilities">Features</Link>
            <Link href="/trust">Public trust</Link>
            <Link href="/status">Status</Link>
            <form action={setLocaleAction} aria-label="Language">
              <input type="hidden" name="locale" value={locale === 'en' ? 'bn' : 'en'} />
              {/* The label is written in the language it switches to, so say so (WCAG 3.1.2). */}
              <button type="submit" className="lang-switch" lang={locale === 'en' ? 'bn' : 'en'}>
                {locale === 'en' ? 'বাংলা' : 'English'}
              </button>
            </form>
            <a className="btn btn-secondary nav-cta" href="/app">
              {signedIn ? 'Workspace' : 'Sign in'}
            </a>
          </nav>
        </header>
        <main id="main">{children}</main>
        <footer className="footer">
          <div className="container footer-inner">
            <span>© {new Date().getFullYear()} VisaStack. Proprietary and confidential.</span>
            <nav className="footer-links" aria-label="Footer">
              <Link href="/#capabilities">Features</Link>
              <Link href="/trust">Public trust</Link>
              <Link href="/status">Status</Link>
              {/* A plain link, like the header's: `/app` sends a visitor on to the sign-in provider, and a
                  prefetch of it would be a blocked cross-origin request. */}
              <a href="/app">{signedIn ? 'Workspace' : 'Sign in'}</a>
            </nav>
          </div>
        </footer>
      </body>
    </html>
  );
}
