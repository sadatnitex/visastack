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
type FooterKey = CatalogKey<typeof homeCatalog>;
type AuthText = PartsTranslator<CatalogKey<typeof authCatalog>>;

export interface FooterNotice {
  /** The version name, from the same words the page's notice shows ("VisaStack Public Beta"). */
  readonly label: string;
  /** What it means in a few words (empty for the public beta, which has only its name). */
  readonly short: string;
}

/** The version line's words, as catalogue keys (the English words come from the page's own notice). */
const NOTICE_KEYS: Readonly<Record<string, FooterKey>> = {
  'VisaStack Public Beta': 'home.layout.noticePublicBeta',
  'VisaStack Private Pilot': 'home.layout.noticePilot',
  'Test version. Made-up details only.': 'home.layout.noticePilotShort',
};

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
  const noticeWord = (english: string): ReactNode => {
    const key = NOTICE_KEYS[english];
    return key ? t.node(key) : publicText(english, pageLang);
  };
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
          <p className="site-footer-about">{t.node('home.layout.footerAbout')}</p>
        </div>
        <nav className="site-footer-nav" aria-label={t('home.layout.footer')}>
          <div className="site-footer-group">
            <p className="site-footer-heading" id="footer-product">
              {t.node('home.layout.product')}
            </p>
            {/* biome-ignore lint/a11y/noRedundantRoles: Safari and VoiceOver drop list semantics from a list with no markers; the role keeps them */}
            {/* biome-ignore lint/a11y/useSemanticElements: the same list, kept as a list for the same reason */}
            <ul role="list" aria-labelledby="footer-product">
              {pick(FOOTER_PRODUCT_ROUTES).map((link) => (
                <li key={link.route}>
                  <Link href={link.href}>{word(link)}</Link>
                </li>
              ))}
            </ul>
          </div>
          <div className="site-footer-group">
            <p className="site-footer-heading" id="footer-trust">
              {t.node('home.layout.footerTrust')}
            </p>
            {/* biome-ignore lint/a11y/noRedundantRoles: Safari and VoiceOver drop list semantics from a list with no markers; the role keeps them */}
            {/* biome-ignore lint/a11y/useSemanticElements: the same list, kept as a list for the same reason */}
            <ul role="list" aria-labelledby="footer-trust">
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
              {t.node('home.layout.footerAccount')}
            </p>
            {/* biome-ignore lint/a11y/noRedundantRoles: Safari and VoiceOver drop list semantics from a list with no markers; the role keeps them */}
            {/* biome-ignore lint/a11y/useSemanticElements: the same list, kept as a list for the same reason */}
            <ul role="list" aria-labelledby="footer-account">
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
            {noticeWord(notice.label)}
            {notice.short ? <>. {noticeWord(notice.short)}</> : null}
          </p>
        ) : null}
        {notice && !notice.short ? (
          <p className="site-footer-asis">
            {t.node('home.layout.footerAsIs')}{' '}
            <Link href="/terms">{t.node('home.layout.terms')}</Link>
            {' · '}
            <Link href="/status">{t.node('home.layout.status')}</Link>
          </p>
        ) : null}
      </div>
    </footer>
  );
}
