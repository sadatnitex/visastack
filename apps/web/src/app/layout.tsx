import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { BrandMark } from '../components/brand-mark';
import { PilotBanner } from '../components/pilot-banner';
import { PwaRuntime } from '../components/pwa/pwa-runtime';
import { SiteNavigation } from '../components/site-navigation';
import { getDeploymentMode } from '../lib/deployment-mode';
import { getLocale } from '../lib/locale';
import { isPublicBetaOpen } from '../lib/public-beta';
import { isServiceWorkerEnabled } from '../lib/pwa/service-worker';
import { isSignedIn } from '../lib/signed-in';
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
    'Keep your passport, documents and visa details in one private profile and reuse them for every application. Review changes and control what you share.',
  applicationName: 'VisaStack',
  // Home-screen app on iPhone and iPad (the manifest covers other devices).
  appleWebApp: { capable: true, title: 'VisaStack', statusBarStyle: 'default' },
  // Stop phones turning passport, reference and account numbers into call or map links.
  formatDetection: { telephone: false, email: false, address: false },
};

// The approved reference stays light, independently of the device appearance.
export const viewport: Viewport = {
  themeColor: '#f7f9fe',
  colorScheme: 'light',
};

export default async function RootLayout({ children }: { readonly children: ReactNode }) {
  // Read-only check of the Neon Auth session, so the nav reflects the real session. It never
  // writes cookies during render and defaults to
  // signed-out if the read fails, so a hiccup never breaks the whole shell.
  const signedIn = await isSignedIn();
  const locale = await getLocale();
  const deploymentMode = getDeploymentMode();
  // The service worker runs only in production builds (the dev server rebuilds files constantly).
  const serviceWorker =
    process.env.NODE_ENV === 'production' && isServiceWorkerEnabled((name) => process.env[name]);

  return (
    <html lang={locale} className={`${inter.variable} ${bengali.variable}`}>
      <body>
        <a className="skip-link" href="#main">
          Skip to Content
        </a>
        {!signedIn ? (
          <PilotBanner mode={deploymentMode} registrationOpen={isPublicBetaOpen()} />
        ) : null}
        <header className="nav">
          <Link className="brand" href="/">
            <BrandMark />
            VisaStack
          </Link>
          <SiteNavigation>
            <div className="site-nav-pages">
              <Link href="/#product">Product</Link>
              <Link href="/#for-agencies">For Agencies</Link>
              <Link href="/trust">Privacy and Control</Link>
              <Link href="/#how-it-works">How It Works</Link>
            </div>
            <div className="site-nav-actions">
              <form action={setLocaleAction} aria-label="Language">
                <input type="hidden" name="locale" value={locale === 'en' ? 'bn' : 'en'} />
                {/* The label is written in the language it switches to, so say so (WCAG 3.1.2). */}
                <button type="submit" className="lang-switch" lang={locale === 'en' ? 'bn' : 'en'}>
                  {locale === 'en' ? 'বাংলা' : 'English'}
                </button>
              </form>
              <a className="btn btn-secondary nav-cta" href="/app">
                {signedIn ? 'Workspace' : 'Sign In'}
              </a>
              {!signedIn && isPublicBetaOpen() ? (
                <Link className="btn btn-primary nav-cta" href="/auth/sign-up">
                  Get Started
                </Link>
              ) : null}
            </div>
          </SiteNavigation>
        </header>
        <main id="main">{children}</main>
        <footer className="footer">
          <div className="container footer-inner">
            <span>© {new Date().getFullYear()} VisaStack. Proprietary and confidential.</span>
            <nav className="footer-links" aria-label="Footer">
              <Link href="/#capabilities">Features</Link>
              <Link href="/trust">Public Trust</Link>
              <Link href="/status">Status</Link>
              <Link href="/privacy">Privacy</Link>
              <Link href="/terms">Terms</Link>
              {/* A plain link, like the header's: `/app` sends a visitor on to the sign-in provider, and a
                  prefetch of it would be a blocked cross-origin request. */}
              <a href="/app">{signedIn ? 'Workspace' : 'Sign In'}</a>
            </nav>
          </div>
        </footer>
        <PwaRuntime enabled={serviceWorker} />
      </body>
    </html>
  );
}
