import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { DocumentPicture } from '../../components/pictures/document-picture';
import { PublicButton } from '../../components/public-site/public-button';
import { publicText } from '../../components/public-site/public-text';
import { Chapter } from '../../components/public-site/scene';
import { ScenesRuntime } from '../../components/public-site/scenes-runtime';
import { HeadlineWords } from '../../components/public-site/story';
import { homeCatalog } from '../../i18n/home';
import { getPageLanguage, getServerT, primeLocale } from '../../lib/i18n-server';
import { isPublicBetaOpen } from '../../lib/public-beta';
import { isSignedIn } from '../../lib/signed-in';
import {
  DESK_CARDS,
  EXAMPLE_CASES,
  PLANS_ACCESS_CLOSED,
  PLANS_ACCESS_OPEN,
  PLANS_LINE,
} from './for-agencies-data';
import './for-agencies.css';
import { CasesTable } from './r5-kit/cases-table';
import { ClosingBand } from './r5-kit/closing-band';
import { RiseIn } from './r5-kit/rise-in';

export const metadata: Metadata = { title: 'For Agencies' };

/**
 * Public For Agencies page (R5 rebuild to the approved reference). Four chapters: the dark hero with
 * an Example case list, what changes at an agency desk, Plans (truthful: no price, no tier), and the
 * closing band. Invite-only as the home page says today, with today's button labels and sign-in flow.
 * Pictures are made of Example figures only: no logos, counts, testimonials, ratings or partner names.
 */
export default async function ForAgenciesPage(): Promise<ReactElement> {
  await primeLocale();
  const lang = getPageLanguage();
  const say = (text: string) => publicText(text, lang);
  // The start button reads the same catalogue words as Home, so the two pages never differ.
  const t = getServerT(homeCatalog);
  const signedIn = await isSignedIn();
  const betaOpen = isPublicBetaOpen();
  const startLabel = signedIn
    ? t.node('home.page.openYourWorkspace')
    : betaOpen
      ? t.node('home.page.createYourFreeAccount')
      : t.node('home.page.signInToGetStarted');
  const startHref = !signedIn && betaOpen ? '/auth/sign-up' : '/app';
  const actions = (
    <>
      <PublicButton href={startHref} variant="primary">
        {startLabel}
      </PublicButton>
      <PublicButton href="/status" variant="secondary">
        {say('See What Works Today')}
      </PublicButton>
    </>
  );

  return (
    <>
      <Chapter tone="dark" labelledBy="agencies-title" className="r5-hero">
        <div className="container r5-hero-grid">
          <div className="r5-hero-copy">
            <p className="r5-kicker">
              {betaOpen ? t.node('home.page.freePublicBeta') : t.node('home.page.inviteOnlyPilot')}
            </p>
            <h1 id="agencies-title" className="r5-title">
              {say('Clients Arrive')} <HeadlineWords>{say('Prepared.')}</HeadlineWords>
            </h1>
            <p className="r5-lede">
              {say('Clients keep their own record. You see only what they share.')}
            </p>
            <div className="r5-actions">{actions}</div>
          </div>
          <CasesTable rows={EXAMPLE_CASES} pageLang={lang} title="Cases" />
        </div>
      </Chapter>

      <Chapter tone="light" labelledBy="agencies-desk-title">
        <div className="container">
          <h2 id="agencies-desk-title" className="r5-h2">
            {say('What Changes')} <HeadlineWords>{say('at Your Desk.')}</HeadlineWords>
          </h2>
          <div className="r5-cards">
            {DESK_CARDS.map((card, i) => (
              <RiseIn as="article" key={card.title} delay={i * 0.1}>
                <span className="r5-card-picture">
                  <DocumentPicture type={card.picture} size={64} />
                </span>
                <h3 className="r5-card-title">{say(card.title)}</h3>
                <p className="r5-card-body">{say(card.body)}</p>
              </RiseIn>
            ))}
          </div>
        </div>
      </Chapter>

      <Chapter tone="light" labelledBy="agencies-plans-title" className="r5-plans">
        <div className="container r5-plans-inner">
          <h2 id="agencies-plans-title" className="r5-h2">
            {say('Plans.')}
          </h2>
          <p className="r5-plans-line">
            {say(PLANS_LINE)} {say(betaOpen ? PLANS_ACCESS_OPEN : PLANS_ACCESS_CLOSED)}
          </p>
        </div>
      </Chapter>

      <ClosingBand
        title={
          <>
            {say('Bring Your Clients.')} <HeadlineWords>{say('Skip the Chasing.')}</HeadlineWords>
          </>
        }
        sub={say('Start with what works today.')}
        actions={
          <>
            {actions}
            <PublicButton href="/countries" variant="secondary">
              {say('Countries')}
            </PublicButton>
          </>
        }
      />
      <ScenesRuntime />
    </>
  );
}
