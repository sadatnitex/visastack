import { catalogResolve, formatDate } from '@visastack/i18n';
import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { BrandMark } from '../components/brand-mark';
import { I18nProvider } from '../components/i18n-provider';
import { PilotBanner, versionNoticeCopy } from '../components/pilot-banner';
import { PwaRuntime } from '../components/pwa/pwa-runtime';
import { SiteNavigation } from '../components/site-navigation';
import { getDeploymentMode } from '../lib/deployment-mode';
import { getT, primePage } from '../lib/i18n-server';
import { LANGUAGE_CHOICE_ENABLED } from '../lib/language-choice';
import { isPublicBetaOpen } from '../lib/public-beta';
import { isServiceWorkerEnabled } from '../lib/pwa/service-worker';
import { isSignedIn } from '../lib/signed-in';
import { hasSeenVersionNotice } from '../lib/version-notice-state';
import { setLocaleAction } from './actions';
import './globals.css';
import { homeCatalog } from '../i18n/home';

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

/** The product name, which stays as it is in every language. */
const PRODUCT_NAME = 'VisaStack';
/** Each language is named in its own words, so the switch reads right to the person it is for. */
const LANGUAGE_NAME = { en: 'English', bn: 'বাংলা' } as const;
const COPYRIGHT_KEY = 'home.layout.getfullyearVisastackProprietaryAndConfidential';

export const metadata: Metadata = {
  // Every page names itself (WCAG 2.4.2): the page's own title, then the product.
  title: { default: 'VisaStack - one profile, every visa', template: '%s | VisaStack' },
  description:
    'A clean file you can stand behind. Keep your passport and documents in one private profile and share only the part you choose.',
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
  const { locale, pageLang: htmlLang } = await primePage();
  // The root layout frames every route, so it reads its words with getT after primePage.
  const t = await getT(homeCatalog);
  // A year is a date, never a grouped count ("২,০২৬"): written as a year, in the language the
  // copyright line itself is shown in, so an English fallback never carries Bengali digits.
  const copyrightYear = formatDate(
    new Date(),
    catalogResolve(homeCatalog, locale, COPYRIGHT_KEY).lang,
    { year: 'numeric' },
  );
  // The page is marked Bangla only where its words are Bangla (WCAG 3.1.2), not for every page.
  const deploymentMode = getDeploymentMode();
  const serviceWorker = isServiceWorkerEnabled((name) => process.env[name]);
  // A visitor sees the notice about this version in full once; after that every page keeps a
  // slim label with the link, and the full words stay under About This Version (footer). A
  // signed-in person never sees the notice, so their cookie is not read.
  const noticeSeen = signedIn || (await hasSeenVersionNotice());
  const hasNotice = versionNoticeCopy(deploymentMode) !== null;

  return (
    <html lang={htmlLang} data-locale={locale} className={`${inter.variable} ${bengali.variable}`}>
      <body>
        <I18nProvider locale={locale} pageLang={htmlLang}>
          <a className="skip-link" href="#main">
            {t.node('home.layout.skipToContent')}
          </a>
          {!signedIn ? (
            <PilotBanner
              mode={deploymentMode}
              registrationOpen={isPublicBetaOpen()}
              seen={noticeSeen}
            />
          ) : null}
          <header className="nav">
            <Link className="brand" href="/">
              <BrandMark />
              {PRODUCT_NAME}
            </Link>
            <SiteNavigation>
              <div className="site-nav-pages">
                <Link href="/#product">{t.node('home.layout.product')}</Link>
                <Link href="/#for-agencies">{t.node('home.page.forAgencies')}</Link>
                <Link href="/trust">{t.node('home.layout.privacyAndControl')}</Link>
                <Link href="/#how-it-works">{t.node('home.page.howItWorks')}</Link>
              </div>
              <div className="site-nav-actions">
                {/* Shown while language choice is on (see LANGUAGE_CHOICE_ENABLED). */}
                {LANGUAGE_CHOICE_ENABLED ? (
                  <form action={setLocaleAction} aria-label={t('home.layout.language')}>
                    <input type="hidden" name="locale" value={locale === 'en' ? 'bn' : 'en'} />
                    {/* The label is written in the language it switches to, so say so (WCAG 3.1.2). */}
                    <button
                      type="submit"
                      className="lang-switch"
                      lang={locale === 'en' ? 'bn' : 'en'}
                    >
                      {LANGUAGE_NAME[locale === 'en' ? 'bn' : 'en']}
                    </button>
                  </form>
                ) : null}
                <a className="btn btn-secondary nav-cta" href="/app">
                  {signedIn ? t.node('home.layout.workspace') : t.node('home.layout.signIn')}
                </a>
                {!signedIn && isPublicBetaOpen() ? (
                  <Link className="btn btn-primary nav-cta" href="/auth/sign-up">
                    {t.node('home.layout.getStarted')}
                  </Link>
                ) : null}
              </div>
            </SiteNavigation>
          </header>
          <main id="main">{children}</main>
          <footer className="footer">
            <div className="container footer-inner">
              <span>{t.node(COPYRIGHT_KEY, { getFullYear: copyrightYear })}</span>
              <nav className="footer-links" aria-label={t('home.layout.footer')}>
                <Link href="/#capabilities">{t.node('home.layout.features')}</Link>
                <Link href="/trust">{t.node('home.layout.publicTrust')}</Link>
                <Link href="/status">{t.node('home.layout.status')}</Link>
                {hasNotice ? (
                  <Link href="/status#about-this-version">
                    {t.node('home.layout.aboutThisVersion')}
                  </Link>
                ) : null}
                <Link href="/privacy">{t.node('home.layout.privacy')}</Link>
                <Link href="/terms">{t.node('home.layout.terms')}</Link>
                {/* A plain link, like the header's: `/app` sends a visitor on to the sign-in provider, and a
                  prefetch of it would be a blocked cross-origin request. */}
                <a href="/app">
                  {signedIn ? t.node('home.layout.workspace') : t.node('home.layout.signIn')}
                </a>
              </nav>
            </div>
          </footer>
          <PwaRuntime enabled={serviceWorker} />
        </I18nProvider>
      </body>
    </html>
  );
}
