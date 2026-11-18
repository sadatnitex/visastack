import type { CatalogKey } from '@visastack/i18n';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { authCatalog } from '../i18n/auth';
import type { homeCatalog } from '../i18n/home';
import type { PartsTranslator } from '../lib/language-parts';
import { BrandMark } from './brand-mark';
import {
  ABOUT_VERSION_HREF,
  FOOTER_LEGAL,
  FOOTER_PRODUCT_ROUTES,
  FOOTER_TRUST_ROUTES,
  type PublicNavLink,
} from './public-site/public-nav';
import { publicText } from './public-site/public-text';

type HomeText = PartsTranslator<CatalogKey<typeof homeCatalog>>;
type AuthText = PartsTranslator<CatalogKey<typeof authCatalog>>;

/**
 * The footer's one short line about what VisaStack is, and its group names. English until the
 * catalogue has them (listed under "Bengali words" in docs/upgrades/programme/pub/NAV2-records.md).
 */
export const FOOTER_ABOUT = 'One private profile for every visa.';
export const FOOTER_GROUPS = { trust: 'Trust', account: 'Account' } as const;

export interface FooterNotice {
  /** The version name, from the same words the page's notice shows ("VisaStack Public Beta"). */
  readonly label: string;
  /** What it means in a few words ("Free, at your own risk."). */
  readonly short: string;
}

/**
 * The public footer (NAV2): the brand with one truthful line, three groups of links (Product,
 * Trust, Account), the version line and the copyright. It claims nothing the product does not do:
 * the version line is the page's own notice, word for word, and every link opens a page that
 * exists. On a phone the groups stack in one column with 44 px targets.
 */
export function SiteFooter({
  t,
  tAuth,
  pageLang,
  pages,
  signedIn,
  registrationOpen,
  notice,
  copyright,
}: {
  readonly t: HomeText;
  readonly tAuth: AuthText;
  readonly pageLang: string;
  /** The public list as the header draws it now (addresses already settled). */
  readonly pages: readonly PublicNavLink[];
  readonly signedIn: boolean;
  readonly registrationOpen: boolean;
  /** The words of this version's notice, or null when none is shown. */
  readonly notice: FooterNotice | null;
  readonly copyright: ReactNode;
}) {
  const pick = (routes: readonly string[]) =>
    routes
      .map((route) => pages.find((page) => page.route === route))
      .filter((page): page is PublicNavLink => page !== undefined);
  const word = (link: PublicNavLink): ReactNode =>
    link.key ? t.node(link.key) : publicText(link.label, pageLang);
  const accountWord = signedIn
    ? t.node('home.layout.workspace')
    : tAuth.node('auth.authSignInPage.signIn');

  return (
    <footer className="footer site-footer">
      <div className="container site-footer-inner">
        <div className="site-footer-brand">
          <Link className="brand" href="/">
            <BrandMark />
            VisaStack
          </Link>
          <p className="site-footer-about">{publicText(FOOTER_ABOUT, pageLang)}</p>
        </div>
        <nav className="site-footer-nav" aria-label={t('home.layout.footer')}>
          <div className="site-footer-group">
            <p className="site-footer-heading" id="footer-product">
              {t.node('home.layout.product')}
            </p>
            <ul aria-labelledby="footer-product">
              {pick(FOOTER_PRODUCT_ROUTES).map((link) => (
                <li key={link.route}>
                  <Link href={link.href}>{word(link)}</Link>
                </li>
              ))}
            </ul>
          </div>
          <div className="site-footer-group">
            <p className="site-footer-heading" id="footer-trust">
              {publicText(FOOTER_GROUPS.trust, pageLang)}
            </p>
            <ul aria-labelledby="footer-trust">
              {pick(FOOTER_TRUST_ROUTES).map((link) => (
                <li key={link.route}>
                  <Link href={link.href}>{word(link)}</Link>
                </li>
              ))}
              {FOOTER_LEGAL.map((entry) => (
                <li key={entry.route}>
                  <Link href={entry.route}>{t.node(entry.key)}</Link>
                </li>
              ))}
              {notice ? (
                <li>
                  <Link href={ABOUT_VERSION_HREF}>{t.node('home.layout.aboutThisVersion')}</Link>
                </li>
              ) : null}
            </ul>
          </div>
          <div className="site-footer-group">
            <p className="site-footer-heading" id="footer-account">
              {publicText(FOOTER_GROUPS.account, pageLang)}
            </p>
            <ul aria-labelledby="footer-account">
              <li>
                {/* A plain link, like the header's: `/app` sends a visitor on to the sign-in
                  provider, and a prefetch of it would be a blocked cross-origin request. */}
                <a href="/app">{accountWord}</a>
              </li>
              {!signedIn && registrationOpen ? (
                <li>
                  <Link href="/auth/sign-up">{t.node('home.layout.getStarted')}</Link>
                </li>
              ) : null}
            </ul>
          </div>
        </nav>
      </div>
      <div className="container site-footer-base">
        <span>{copyright}</span>
        {notice ? (
          <p className="site-footer-beta">
            {publicText(`${notice.label}. ${notice.short}`, pageLang)}
          </p>
        ) : null}
      </div>
    </footer>
  );
}
