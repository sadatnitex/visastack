import { destinationByIso2 } from '@visastack/core/destinations';
import type { Locale } from '@visastack/i18n';
import type { Destination } from '../components/landing/planner';
import { homeCatalog } from '../i18n/home';
import { landingCatalog } from '../i18n/landing';
import { getDeploymentMode } from '../lib/deployment-mode';
import { getServerT, primeLocale } from '../lib/i18n-server';
import { isPublicBetaOpen } from '../lib/public-beta';
import { isSignedIn } from '../lib/signed-in';
import { HomeLanding } from './home-landing';

/**
 * The public home page, the owner-approved homepage (Harbor Blue folio, English first): a
 * Bangladesh-focused first screen with the destination planner, the plan it opens, sources and
 * status, a sample family case, the reusable record, the agency workflow, the common questions and
 * one closing action. The body is `home-landing.tsx`; the planner's choice state is the one small
 * client part (`components/landing/planner.tsx`).
 *
 * Written for a traveller or an agency who has never heard of the product: plain words, and every
 * drawn example says it is an example (guarded by `lib/plain-language.test.ts`). The account button
 * keeps today's labels and links: which one leads depends on whether the visitor is signed in and
 * whether the public beta is open.
 */

/**
 * The destinations the planner suggests first, by their two-letter codes. Each name comes from the
 * country catalogue, so it is the very name the country guides search for (`/countries?q=`); a code
 * the catalogue does not hold is left out rather than guessed.
 */
const SUGGESTED_DESTINATIONS = ['JP', 'SG', 'GB', 'CA', 'DE', 'AU'] as const;

/**
 * Each destination as the guides search for it (`value`, the catalogue's English country name,
 * which never changes with the language) and as the visitor reads it (`label`: the catalogue name
 * in English, the standard Bengali region name from the platform's locale data in Bengali).
 */
function suggestedDestinations(locale: Locale): Destination[] {
  const names = locale === 'bn' ? new Intl.DisplayNames(['bn-BD'], { type: 'region' }) : null;
  return SUGGESTED_DESTINATIONS.flatMap((iso2) => {
    const destination = destinationByIso2(iso2);
    if (!destination) return [];
    return [{ value: destination.country, label: names?.of(iso2) ?? destination.country }];
  });
}

interface HomePageProps {
  readonly searchParams: Promise<{ readonly auth_error?: string }>;
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const locale = await primeLocale();
  const t = getServerT(homeCatalog);
  const tl = getServerT(landingCatalog);
  // A failed sign-in sends the visitor back here with a short reference that holds no
  // personal information (see apps/web/src/app/callback/route.ts), so they get a way
  // forward instead of a blank error page.
  const { auth_error: authError } = await searchParams;
  // Someone already signed in is taken straight to their workspace, never asked to sign in again.
  const signedIn = await isSignedIn();
  const betaOpen = isPublicBetaOpen();
  const startLabel = signedIn
    ? tl.node('landing.account.workspace')
    : betaOpen
      ? tl.node('landing.account.create')
      : t.node('home.page.signInToGetStarted');
  const startHref = !signedIn && betaOpen ? '/auth/sign-up' : '/app';

  // The public-beta wording the owner fixed (lib/public-beta-wording.test.tsx): the same words as the
  // banner and the legal pages, shown once at the foot of the page.
  const notice = (
    <>
      {betaOpen
        ? t.node('home.page.registrationIsOpenForPublicBeta')
        : t.node('home.page.thisIsAPrivatePilotFor')}{' '}
      {betaOpen
        ? t.node('home.page.itIsFreeToUseAt')
        : t.node('home.page.pleaseUseMadeUpDetailsOr')}
    </>
  );

  return (
    <HomeLanding
      destinations={suggestedDestinations(locale)}
      deploymentMode={getDeploymentMode()}
      registrationOpen={betaOpen}
      start={{ label: startLabel, href: startHref }}
      notice={notice}
      statusLabel={t.node('home.page.seeWhatWorksToday')}
      alert={
        authError ? (
          <p className="notice notice-warn lp-alert" role="alert">
            {t.node('home.page.signInDidnTCompletePlease')} <strong>{authError}</strong>.
          </p>
        ) : null
      }
    />
  );
}
