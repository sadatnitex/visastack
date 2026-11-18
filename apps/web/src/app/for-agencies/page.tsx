import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { PublicButton } from '../../components/public-site/public-button';
import { publicText } from '../../components/public-site/public-text';
import { ReadinessRing } from '../../components/public-site/readiness-ring';
import { Chapter, Scene } from '../../components/public-site/scene';
import { ScenesRuntime } from '../../components/public-site/scenes-runtime';
import {
  ExampleTag,
  HeadlineWords,
  StatusChip,
  StoryCard,
} from '../../components/public-site/story';
import { homeCatalog } from '../../i18n/home';
import { getPageLanguage, getServerT, primeLocale } from '../../lib/i18n-server';
import { isPublicBetaOpen } from '../../lib/public-beta';
import { isSignedIn } from '../../lib/signed-in';
import { AGENCY_POINTS, EXAMPLE_LINE, EXAMPLE_SHARING } from './for-agencies-data';
import './for-agencies.css';

export const metadata: Metadata = { title: 'For Agencies' };

/**
 * Public For Agencies page (WP-PUB4). Invite-only as the home page says today, with today's button
 * labels and the same sign-in flow. It states what the product does and shows pictures made of
 * Example figures only: no logos, counts, testimonials, ratings or partner names.
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
    <div className="pub4a-actions">
      <PublicButton href={startHref} variant="primary">
        {startLabel}
      </PublicButton>
      <PublicButton href="/status" variant="secondary">
        {say('See What Works Today')}
      </PublicButton>
    </div>
  );

  return (
    <>
      <Chapter tone="dark" labelledBy="agencies-title" className="pub4a-hero">
        <div className="container pub4a-hero-copy">
          <p className="pub4a-kicker">
            {betaOpen ? t.node('home.page.freePublicBeta') : t.node('home.page.inviteOnlyPilot')}
          </p>
          <h1 id="agencies-title" className="pub4a-title">
            {say('Stop Chasing Documents')} <HeadlineWords>{say('by Message')}</HeadlineWords>
          </h1>
          <p className="pub4a-lede">
            {say('Ask for a document, then see when it arrives, all in one place.')}
          </p>
          {actions}
        </div>
      </Chapter>

      <Chapter tone="light" labelledBy="agencies-gets-title">
        <div className="container">
          <h2 id="agencies-gets-title" className="pub4a-h2">
            {say('What an Agency Gets')}
          </h2>
          <div className="pub4a-grid">
            {AGENCY_POINTS.map((point) => (
              <StoryCard
                key={point.title}
                title={say(point.title)}
                body={say(point.body)}
                pageLang={lang}
              />
            ))}
          </div>
        </div>
      </Chapter>

      <Chapter tone="dark">
        <Scene name="line" len={2} steps={3} labelledBy="agencies-line-title">
          <div className="container pub4a-line">
            <h2 id="agencies-line-title" className="pub4a-h2">
              {say('One Case, One Clear Line')}
            </h2>
            <div className="pub4a-board">
              <ExampleTag pageLang={lang} />
              <ReadinessRing
                done={1}
                total={3}
                size="lg"
                countLabel="Items Complete"
                pageLang={lang}
              />
              <ol className="pub4a-steps">
                {EXAMPLE_LINE.map((row) => (
                  <li key={row.status} className="pub4a-step">
                    <StatusChip status={row.status} pageLang={lang} />
                    <strong className="pub4a-step-name">{say(row.name)}</strong>
                    <span className="pub4a-step-note">{say(row.note)}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </Scene>
      </Chapter>

      <Chapter tone="light" labelledBy="agencies-share-title">
        <div className="container">
          <h2 id="agencies-share-title" className="pub4a-h2">
            {say('You See Only What Is Shared')}
          </h2>
          <div className="pub4a-grid pub4a-grid-two">
            <StoryCard
              title={say('Saved Is Not Shared')}
              body={say(
                "A client's record is private. Sharing starts with their permission, and every sharing decision is recorded.",
              )}
              example
              pageLang={lang}
              raised
            >
              <ul className="pub4a-chips" aria-label="Example States">
                {EXAMPLE_SHARING.map((status) => (
                  <li key={status}>
                    <StatusChip status={status} pageLang={lang} />
                  </li>
                ))}
              </ul>
            </StoryCard>
            <StoryCard
              title={say('Access Can End')}
              body={say('Access can end on a date the client sets, and the change is recorded.')}
              pageLang={lang}
            />
          </div>
        </div>
      </Chapter>

      <Chapter tone="dark" labelledBy="agencies-close-title">
        <div className="container pub4a-hero-copy">
          <h2 id="agencies-close-title" className="pub4a-h2">
            {say('One Traveller Profile, Fewer Repeat Requests')}
          </h2>
          {actions}
          <PublicButton href="/countries" variant="secondary">
            {say('Countries')}
          </PublicButton>
        </div>
      </Chapter>
      <ScenesRuntime />
    </>
  );
}
