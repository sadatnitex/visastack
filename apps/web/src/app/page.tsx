import { homeCatalog } from '../i18n/home';
import { getPageLanguage, getServerT, primeLocale } from '../lib/i18n-server';
import { isPublicBetaOpen } from '../lib/public-beta';
import { resolveOwnDetailsWelcome } from '../lib/real-data-wording';
import { isSignedIn } from '../lib/signed-in';
import { HomeStory } from './home-story';

/**
 * The public home page, rebuilt on the owner-approved reference (R1, 18 Nov 2026): eight chapters
 * (the record, adding a document, the country checklist, the case journey, sharing, sources,
 * agencies and the closing call) and nothing else between the header and the footer. The pictures
 * and chapter parts live in `components/public-site/kit`; the story in `home-story.tsx`.
 *
 * Written for a traveller or an agency who has never heard of the product: plain words, and every
 * drawn example says it is an example. No engineering vocabulary and no tool names (guarded by
 * `lib/plain-language.test.ts`). The buttons keep today's labels and links: which one leads depends
 * on whether the visitor is signed in and whether the public beta is open.
 */

interface HomePageProps {
  readonly searchParams: Promise<{ readonly auth_error?: string }>;
}

export default async function HomePage({ searchParams }: HomePageProps) {
  await primeLocale();
  const t = getServerT(homeCatalog);
  // A failed sign-in sends the visitor back here with a short reference that holds no
  // personal information (see apps/web/src/app/callback/route.ts), so they get a way
  // forward instead of a blank error page.
  const { auth_error: authError } = await searchParams;
  // Someone already signed in is taken straight to their workspace, never asked to sign in again.
  const signedIn = await isSignedIn();
  const betaOpen = isPublicBetaOpen();
  const ownWelcome = await resolveOwnDetailsWelcome();
  const startLabel = signedIn
    ? t.node('home.page.openYourWorkspace')
    : betaOpen
      ? t.node('home.page.createYourFreeAccount')
      : t.node('home.page.signInToGetStarted');
  const startHref = !signedIn && betaOpen ? '/auth/sign-up' : '/app';

  // The public-beta wording the owner fixed (lib/public-beta-wording.test.tsx): the same words as the
  // banner and the legal pages, shown once at the foot of the page.
  const notice = (
    <>
      {betaOpen
        ? t.node('home.page.registrationIsOpenForPublicBeta')
        : t.node('home.page.thisIsAPrivatePilotFor')}{' '}
      {ownWelcome
        ? t.node('home.page.itIsFreeToUseAt')
        : t.node('home.page.pleaseUseMadeUpDetailsOr')}
    </>
  );

  return (
    <HomeStory
      notice={notice}
      pageLang={getPageLanguage()}
      nudge={betaOpen ? t.node('home.page.freePublicBeta') : t.node('home.page.inviteOnlyPilot')}
      alert={
        authError ? (
          <p className="notice notice-warn hs-alert" role="alert">
            {t.node('home.page.signInDidnTCompletePlease')} <strong>{authError}</strong>.
          </p>
        ) : null
      }
      actions={{
        start: { label: startLabel, href: startHref },
        status: { label: t.node('home.page.seeWhatWorksToday'), href: '/status' },
        forAgencies: t.node('home.page.forAgencies'),
      }}
    />
  );
}
