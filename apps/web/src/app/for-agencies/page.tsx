import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { PublicButton } from '../../components/public-site/public-button';
import { ReadinessRing } from '../../components/public-site/readiness-ring';
import { Chapter, Scene } from '../../components/public-site/scene';
import { ScenesRuntime } from '../../components/public-site/scenes-runtime';
import {
  ExampleTag,
  HeadlineWords,
  StatusChip,
  StoryCard,
} from '../../components/public-site/story';
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
  const signedIn = await isSignedIn();
  const betaOpen = isPublicBetaOpen();
  const startLabel = signedIn
    ? 'Open Your Workspace'
    : betaOpen
      ? 'Create Your Free Account'
      : 'Sign In to Get Started';
  const startHref = !signedIn && betaOpen ? '/auth/sign-up' : '/app';
  const actions = (
    <div className="pub4a-actions">
      <PublicButton href={startHref} variant="primary">
        {startLabel}
      </PublicButton>
      <PublicButton href="/status" variant="secondary">
        See What Works Today
      </PublicButton>
    </div>
  );

  return (
    <>
      <Chapter tone="dark" labelledBy="agencies-title" className="pub4a-hero">
        <div className="container pub4a-hero-copy">
          <p className="pub4a-kicker">{betaOpen ? 'Free Public Beta' : 'Invite-Only Pilot'}</p>
          <h1 id="agencies-title" className="pub4a-title">
            Stop Chasing Documents <HeadlineWords>by Message</HeadlineWords>
          </h1>
          <p className="pub4a-lede">
            Ask for a document, then see when it arrives, all in one place.
          </p>
          {actions}
        </div>
      </Chapter>

      <Chapter tone="light" labelledBy="agencies-gets-title">
        <div className="container">
          <h2 id="agencies-gets-title" className="pub4a-h2">
            What an Agency Gets
          </h2>
          <div className="pub4a-grid">
            {AGENCY_POINTS.map((point) => (
              <StoryCard key={point.title} title={point.title} body={point.body} />
            ))}
          </div>
        </div>
      </Chapter>

      <Chapter tone="dark">
        <Scene name="line" len={2} steps={3} labelledBy="agencies-line-title">
          <div className="container pub4a-line">
            <h2 id="agencies-line-title" className="pub4a-h2">
              One Case, One Clear Line
            </h2>
            <div className="pub4a-board">
              <ExampleTag />
              <ReadinessRing done={1} total={3} size="lg" countLabel="Documents Complete" />
              <ol className="pub4a-steps">
                {EXAMPLE_LINE.map((row) => (
                  <li key={row.status} className="pub4a-step">
                    <StatusChip status={row.status} />
                    <strong className="pub4a-step-name">{row.name}</strong>
                    <span className="pub4a-step-note">{row.note}</span>
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
            You See Only What Is Shared
          </h2>
          <div className="pub4a-grid pub4a-grid-two">
            <StoryCard
              title="Saved Is Not Shared"
              body="A client's record is private. Sharing starts with their permission, and every sharing decision is recorded."
              example
              raised
            >
              <ul className="pub4a-chips" aria-label="Example States">
                {EXAMPLE_SHARING.map((status) => (
                  <li key={status}>
                    <StatusChip status={status} />
                  </li>
                ))}
              </ul>
            </StoryCard>
            <StoryCard
              title="Access Can End"
              body="Access can end on a date the client sets, and the change is recorded."
            />
          </div>
        </div>
      </Chapter>

      <Chapter tone="dark" labelledBy="agencies-close-title">
        <div className="container pub4a-hero-copy">
          <h2 id="agencies-close-title" className="pub4a-h2">
            One Traveller Profile, Fewer Repeat Requests
          </h2>
          {actions}
        </div>
      </Chapter>
      <ScenesRuntime />
    </>
  );
}
