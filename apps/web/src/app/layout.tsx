import { catalogResolve, formatDate } from '@visastack/i18n';
import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { BrandMark } from '../components/brand-mark';
import { I18nProvider } from '../components/i18n-provider';
import { Icon } from '../components/icons';
import { SaveDataFlag } from '../components/pictures/save-data-flag';
import { requestSavesData } from '../components/pictures/save-data-request';
import { PilotBanner, versionNoticeCopy } from '../components/pilot-banner';
import {
  HEADER_PAGE_ROUTES,
  HOW_MENU,
  HOW_MENU_ROUTES,
  PHONE_MENU_EXTRAS,
  publicNavLinks,
} from '../components/public-site/public-nav';
import { publicText } from '../components/public-site/public-text';
import { ScenesBoot, requestNonce } from '../components/public-site/scenes-boot';
import { PwaRuntime } from '../components/pwa/pwa-runtime';
import { SiteFooter } from '../components/site-footer';
import { SiteNavigation } from '../components/site-navigation';
import { appHomeCatalog } from '../i18n/app-home';
import { getDeploymentMode } from '../lib/deployment-mode';
import { getT, primePage } from '../lib/i18n-server';
import { LANGUAGE_CHOICE_ENABLED } from '../lib/language-choice';
import { signedInPerson } from '../lib/public-account';
import { isPublicBetaOpen } from '../lib/public-beta';
import { ClearShareInboxOnSubmit } from '../lib/pwa/clear-share-inbox-on-submit';
import { isServiceWorkerEnabled } from '../lib/pwa/service-worker';
import { signOutCurrentUser } from '../lib/sign-out';
import { isSignedIn } from '../lib/signed-in';
import { hasSeenVersionNotice } from '../lib/version-notice-state';
import { setLocaleAction } from './actions';
import { AccountMenu } from './app/account-menu';
import { TurnOffPushOnSubmit } from './app/account/push-card';
import './globals.css';
import { authCatalog } from '../i18n/auth';
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
  // "Sign In" is the same action the sign-in screen names, so it shares that screen's message.
  const tAuth = await getT(authCatalog);
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
  const registrationOpen = isPublicBetaOpen();
  // The words of this version's notice, so the footer says the same and nothing more.
  const notice = versionNoticeCopy(deploymentMode, registrationOpen);
  const links = publicNavLinks(undefined, { signedIn });
  // The sign-up button shows to a visitor while registration is open; it is the bar's one filled
  // action, and Sign In turns quiet beside it. Otherwise Sign In (or Workspace) is the action.
  const showGetStarted = !signedIn && registrationOpen;
  // The switch names the language it switches to, in that language's own words (WCAG 3.1.2). It is
  // drawn in the bar on a wide screen and in the menu on a narrow one: one is hidden by the stylesheet.
  // Only the bar's form carries the landmark name, so the two never share one.
  const otherLocale = locale === 'en' ? 'bn' : 'en';
  const languageForm = (className: string, named = true) =>
    LANGUAGE_CHOICE_ENABLED ? (
      <form
        className="lang-form"
        action={setLocaleAction}
        aria-label={named ? t('home.layout.language') : undefined}
      >
        {/* The menu's copy sends the language with the button itself, so the page has one hidden
          language field, the bar's. */}
        {named ? <input type="hidden" name="locale" value={otherLocale} /> : null}
        {named ? (
          <button type="submit" className={className} lang={locale === 'en' ? 'bn' : 'en'}>
            {LANGUAGE_NAME[otherLocale]}
          </button>
        ) : (
          // The menu's copy names its language only where it differs from the page's own (a part
          // in the page's own language needs no mark), and carries its own value.
          <button
            type="submit"
            className={className}
            name="locale"
            value={otherLocale}
            {...(htmlLang !== otherLocale ? { lang: otherLocale } : {})}
          >
            {LANGUAGE_NAME[otherLocale]}
          </button>
        )}
      </form>
    ) : null;
  // "Sign In" is the same action the sign-in screen names; a plain link, because `/app` sends a
  // visitor on to the sign-in provider and a prefetch of it would be a blocked cross-origin request.
  const signInLink = (className: string) => (
    <a className={className} href="/app">
      {signedIn ? t.node('home.layout.workspace') : tAuth.node('auth.authSignInPage.signIn')}
    </a>
  );
  // NAV3: a signed-in visitor's own controls on the public pages. The first name only (never the
  // address), from the session read the page already made; the words are the workspace's own, so
  // the two places never drift. Sign Out is the workspace menu's own server action form, a POST.
  // The root layout does not draw again when a person moves between pages in the browser, so the
  // markup cannot depend on the page: it is always here for a signed-in visitor, and the
  // stylesheet hides this whole header and footer inside the workspace (body:has(.app-frame)).
  const person = signedIn ? await signedInPerson() : null;
  const account = signedIn
    ? {
        firstName: person?.firstName ?? '',
        initials: person?.initials ?? '',
        tApp: await getT(appHomeCatalog),
      }
    : null;
  const signOutForm = (className: string) =>
    account ? (
      <form
        className="account-signout-form"
        action={async (form: FormData) => {
          'use server';
          await signOutCurrentUser('/', form);
        }}
      >
        <ClearShareInboxOnSubmit />
        <TurnOffPushOnSubmit />
        <button type="submit" className={className}>
          <Icon name="logout" size={18} />
          {account.tApp.node('appHome.appWorkspaceFrame.signOut')}
        </button>
      </form>
    ) : null;
  const accountLinks = account
    ? [
        { href: '/app', label: t('home.layout.workspace'), icon: 'home' as const },
        {
          href: '/app/account',
          label: account.tApp('appHome.appAppNav.yourAccount'),
          icon: 'user' as const,
        },
      ]
    : [];
  // Data saver from the request (Save-Data: on) keeps picture motion still from the first paint.
  const saveDataMark = (await requestSavesData()) ? { 'data-save-data': '' } : {};
  const fonts = `${inter.variable} ${bengali.variable}`;
  // This request's script nonce, for the early scenes mark in the head (none outside a request).
  const scenesNonce = await requestNonce();

  return (
    <html lang={htmlLang} data-locale={locale} className={fonts} {...saveDataMark}>
      <head>
        {/* WP-PUB1 (ADR 0029): the early scenes mark, nonce'd; see scenes-boot.tsx. */}
        <ScenesBoot nonce={scenesNonce} />
      </head>
      <body>
        <I18nProvider locale={locale} pageLang={htmlLang}>
          <a className="skip-link" href="#main">
            {t.node('home.layout.skipToContent')}
          </a>
          {!signedIn ? (
            <PilotBanner
              mode={deploymentMode}
              registrationOpen={registrationOpen}
              seen={noticeSeen}
            />
          ) : null}
          <header className="nav">
            <Link className="brand" href="/">
              <BrandMark />
              {PRODUCT_NAME}
            </Link>
            {/* The five public pages in one list (WP-PUB1), then the actions (NAV2). Words with a
              translation come from the catalogue; the others are marked English on a Bangla page.
              A narrow screen moves the pages, the language switch and the quiet sign-in into the
              menu; the single action that matters stays in the bar. */}
            <SiteNavigation
              group={{
                label: t.node('home.page.howItWorks'),
                currentRoutes: HOW_MENU_ROUTES,
                items: HOW_MENU.map((entry) => ({
                  href: entry.href,
                  label: publicText(entry.label, htmlLang),
                  description: publicText(entry.description, htmlLang),
                  ...(entry.wideOnly ? { wideOnly: true } : {}),
                })),
              }}
              pages={links
                .filter((link) => HEADER_PAGE_ROUTES.includes(link.route))
                .map((link) => ({
                  href: link.href,
                  route: link.route,
                  label: link.key ? t.node(link.key) : publicText(link.label, htmlLang),
                }))}
              menuExtras={
                <>
                  {PHONE_MENU_EXTRAS.map((extra) => (
                    <a className="menu-link" href={extra.href} key={extra.href}>
                      {publicText(extra.label, htmlLang)}
                    </a>
                  ))}
                  {languageForm('menu-lang', false)}
                  {showGetStarted ? signInLink('menu-signin') : null}
                  {account ? (
                    <div className="menu-account">
                      <a className="menu-signin" href="/app">
                        {t.node('home.layout.workspace')}
                      </a>
                      <a className="menu-signin" href="/app/account">
                        {account.tApp.node('appHome.appAppNav.yourAccount')}
                      </a>
                      {signOutForm('menu-signin menu-signout')}
                    </div>
                  ) : null}
                </>
              }
              actions={
                <>
                  {languageForm('lang-switch')}
                  {showGetStarted
                    ? signInLink('btn btn-secondary nav-cta nav-signin site-bar-only')
                    : null}
                  {showGetStarted ? (
                    <Link className="btn btn-primary nav-cta" href="/auth/sign-up">
                      {t.node('home.layout.getStarted')}
                    </Link>
                  ) : (
                    signInLink('btn btn-primary nav-cta')
                  )}
                  {account ? (
                    <div className="nav-account">
                      <AccountMenu
                        variant="public"
                        name={account.firstName}
                        initials={account.initials}
                        links={accountLinks}
                        signOut={signOutForm('btn btn-secondary nav-cta')}
                      />
                    </div>
                  ) : null}
                </>
              }
            />
          </header>
          <main id="main">{children}</main>
          <SiteFooter
            t={t}
            tAuth={tAuth}
            pageLang={htmlLang}
            pages={links}
            signedIn={signedIn}
            signOut={signOutForm('footer-signout')}
            registrationOpen={registrationOpen}
            notice={notice ? { label: notice.label, short: notice.short } : null}
            copyright={t.node(COPYRIGHT_KEY, { getFullYear: copyrightYear })}
          />
          <PwaRuntime enabled={serviceWorker} />
          <SaveDataFlag />
        </I18nProvider>
      </body>
    </html>
  );
}
